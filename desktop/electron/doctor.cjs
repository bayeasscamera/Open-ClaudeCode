const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const GIT_TIMEOUT_MS = 3000
const APP_PROCESS_TIMEOUT_MS = 1200
const SECRET_FILENAME_RE = /(^|[/\\])(\.env|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|.*(secret|token|credential|apikey|api-key|private).*|.*\.(pem|key|p12|pfx))$/i

function check(id, title, status, detail = '', meta = {}) {
  return {
    id,
    title,
    status,
    detail,
    meta,
  }
}

function statusRank(status) {
  if (status === 'error') return 3
  if (status === 'warning') return 2
  if (status === 'info') return 1
  return 0
}

function summarize(checks) {
  const counts = checks.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1
    return acc
  }, {})
  const worst = checks.reduce((current, item) => (
    statusRank(item.status) > statusRank(current) ? item.status : current
  ), 'ok')
  return {
    status: worst,
    ok: worst !== 'error',
    errors: counts.error || 0,
    warnings: counts.warning || 0,
    infos: counts.info || 0,
    passed: counts.ok || 0,
    total: checks.length,
  }
}

function safeStat(target) {
  try {
    return fs.statSync(target)
  } catch {
    return null
  }
}

function safeRealpath(target) {
  try {
    return fs.realpathSync(target)
  } catch {
    return ''
  }
}

function appRuntimeStatus(appPath = '/Applications/OPC.app') {
  const marker = path.join(appPath, 'Contents')
  const pgrep = spawnSync('pgrep', ['-f', marker], {
    encoding: 'utf8',
    timeout: APP_PROCESS_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
  })
  if (pgrep.error || pgrep.status > 1) return { running: false, pids: [], error: pgrep.error?.message || String(pgrep.stderr || '').trim() }
  const pids = String(pgrep.stdout || '')
    .split(/\s+/)
    .map(value => Number(value))
    .filter(Number.isFinite)
  if (!pids.length) return { running: false, pids: [] }
  const ps = spawnSync('ps', ['-p', pids.join(','), '-o', 'pid=,args='], {
    encoding: 'utf8',
    timeout: APP_PROCESS_TIMEOUT_MS,
    maxBuffer: 128 * 1024,
  })
  const processes = String(ps.stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.includes(marker))
    .slice(0, 8)
  const filteredPids = processes
    .map(line => Number((line.match(/^(\d+)/) || [])[1]))
    .filter(Number.isFinite)
  return {
    running: Boolean(filteredPids.length),
    pids: filteredPids.length ? filteredPids : pids,
    processes,
  }
}

function commandStatus(command, args, timeout = APP_PROCESS_TIMEOUT_MS) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 256 * 1024,
  })
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error?.message || '',
  }
}

function releaseTrustStatus(appPath = '/Applications/OPC.app') {
  if (process.platform !== 'darwin') {
    return { status: 'info', detail: 'Vérification signature/notarization macOS non applicable.', meta: { platform: process.platform } }
  }
  if (!safeStat(appPath)?.isDirectory()) {
    return { status: 'warning', detail: 'App installée introuvable: signature/notarization non vérifiable.', meta: { appPath } }
  }
  const codesignVerify = commandStatus('codesign', ['--verify', '--deep', '--strict', appPath])
  const codesignDetails = commandStatus('codesign', ['-dv', '--verbose=4', appPath])
  const detailsText = [codesignDetails.stdout, codesignDetails.stderr].filter(Boolean).join('\n')
  const adHoc = /Signature=adhoc/i.test(detailsText) || !/Authority=/i.test(detailsText)
  const spctl = commandStatus('spctl', ['-a', '-vv', '-t', 'exec', appPath])
  const notarized = spctl.ok && /accepted/i.test(`${spctl.stdout}\n${spctl.stderr}`)
  const meta = {
    appPath,
    codesignOk: codesignVerify.ok,
    codesignStatus: codesignVerify.status,
    spctlOk: spctl.ok,
    spctlStatus: spctl.status,
    adHoc,
    notarized,
    codesign: (codesignVerify.stderr || codesignDetails.stderr || '').slice(0, 1200),
    spctl: (spctl.stderr || spctl.stdout || '').slice(0, 1200),
  }
  if (!codesignVerify.ok) {
    return { status: 'warning', detail: 'App non signée ou signature invalide. Distribution publique à bloquer avant release.', meta }
  }
  if (adHoc || !notarized) {
    return { status: 'warning', detail: 'Signature locale détectée, mais notarization/Gatekeeper non validée pour release publique.', meta }
  }
  return { status: 'ok', detail: 'Signature et validation Gatekeeper OK.', meta }
}

function runGit(cwd, args) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 512 * 1024,
  })
}

function gitRoot(cwd) {
  if (!cwd || !safeStat(cwd)?.isDirectory()) return ''
  const result = runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (result.error || result.status !== 0) return ''
  return String(result.stdout || '').trim()
}

function parseGitStatus(output = '') {
  return String(output || '')
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(line => {
      const status = line.slice(0, 2).trim() || '??'
      const file = line.slice(3).trim()
      return { status, file }
    })
}

function gitHygieneCheck(id, label, cwd) {
  const stat = safeStat(cwd)
  if (!cwd || !stat) return check(id, label, 'warning', 'Dossier introuvable ou non défini.', { cwd })
  if (!stat.isDirectory()) return check(id, label, 'warning', 'Le chemin n’est pas un dossier.', { cwd })
  const root = gitRoot(cwd)
  if (!root) return check(id, label, 'info', 'Aucun dépôt git détecté pour ce dossier.', { cwd: safeRealpath(cwd) || cwd })

  const result = runGit(root, ['status', '--short'])
  if (result.error) return check(id, label, 'warning', `git status indisponible: ${result.error.message}`, { cwd: root })
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim()
    return check(id, label, 'warning', stderr || 'git status a échoué.', { cwd: root, code: result.status })
  }

  const entries = parseGitStatus(result.stdout)
  const untracked = entries.filter(entry => entry.status === '??')
  const modified = entries.filter(entry => entry.status !== '??')
  const secretLike = entries.filter(entry => SECRET_FILENAME_RE.test(entry.file))
  if (secretLike.length) {
    return check(id, label, 'error', `${secretLike.length} fichier(s) sensible(s) apparaissent dans git status.`, {
      cwd: root,
      changed: entries.length,
      modified: modified.length,
      untracked: untracked.length,
      secretLike: secretLike.map(entry => entry.file).slice(0, 12),
    })
  }
  if (entries.length > 80) {
    return check(id, label, 'warning', `${entries.length} changement(s) git détectés. Le diagnostic reste utilisable, mais la surface est large.`, {
      cwd: root,
      changed: entries.length,
      modified: modified.length,
      untracked: untracked.length,
    })
  }
  if (entries.length) {
    return check(id, label, 'warning', `${entries.length} changement(s) git détectés.`, {
      cwd: root,
      changed: entries.length,
      modified: modified.length,
      untracked: untracked.length,
    })
  }
  return check(id, label, 'ok', 'Worktree propre.', { cwd: root, changed: 0, modified: 0, untracked: 0 })
}

function createDoctor({ projectRoot, cliRunner, providerConfigStore, memoryStore, desktopStateStore, appPath = '/Applications/OPC.app', appRuntime = appRuntimeStatus, releaseTrust = releaseTrustStatus }) {
  function selectedProfile(model) {
    try {
      providerConfigStore.reload()
      return providerConfigStore.profileForModel(model)
    } catch {
      return null
    }
  }

  function providerChecks(model) {
    const checks = []
    let editable = null
    const repair = providerConfigStore.repairKnownProviderIssues?.() || { repaired: false, count: 0 }
    checks.push(check(
      'provider-repair',
      'Réparation provider',
      'ok',
      repair.repaired
        ? `${repair.count} correction(s) appliquée(s): URL legacy, paramètres Think ou extra body.`
        : 'Aucune réparation provider nécessaire.',
      { repaired: Boolean(repair.repaired), count: repair.count || 0 },
    ))
    try {
      editable = providerConfigStore.editableConfig()
    } catch (error) {
      checks.push(check('provider-config', 'Configuration provider', 'error', error.message || String(error)))
      return checks
    }

    const profiles = Array.isArray(editable.profiles) ? editable.profiles : []
    const selected = selectedProfile(model)
    const missingSecrets = profiles.filter(profile => !profile.noAuth && !profile.apiKeySet).length
    checks.push(check(
      'provider-config',
      'Configuration provider',
      editable.configError ? 'error' : profiles.length ? 'ok' : 'warning',
      editable.configError || `${profiles.length} profil(s), ${missingSecrets} clé(s) manquante(s).`,
      {
        path: editable.path,
        defaultModel: editable.defaultModel,
        profiles: profiles.length,
        missingSecrets,
      },
    ))

    if (!selected) {
      checks.push(check('provider-selected', 'Modèle sélectionné', 'error', 'Aucun profil ne correspond au modèle choisi.', { model }))
      return checks
    }

    const caps = providerConfigStore.capabilities(selected)
    const timeoutMs = providerConfigStore.requestTimeout(selected)
    const warnings = []
    if (caps.agent === false) warnings.push('agent CLI indisponible')
    if (caps.tools === false) warnings.push('outils désactivés')
    if (caps.streaming === false) warnings.push('streaming indisponible')
    if (caps.thinking !== false) warnings.push('Think devrait rester désactivé')
    const selectedEditable = profiles.find(profile => profile.model === selected.model || profile.id === selected.id)
    const hasAuth = selected.auth === false || selected.noAuth === true || selected.apiKey || selectedEditable?.apiKeySet
    checks.push(check(
      'provider-selected',
      'Modèle sélectionné',
      !hasAuth ? 'error' : warnings.length ? 'warning' : 'ok',
      !hasAuth
        ? 'Le provider sélectionné n’a pas de clé ou de mode sans auth.'
        : warnings.length
          ? warnings.join(', ')
          : `${providerConfigStore.name(selected)} prêt, timeout ${Math.round(timeoutMs / 1000)}s.`,
      {
        model: selected.model,
        label: providerConfigStore.name(selected),
        provider: providerConfigStore.providerName(selected),
        upstreamApi: providerConfigStore.upstreamApi(selected),
        timeoutMs,
        retries: providerConfigStore.retryCount(selected),
        capabilities: caps,
      },
    ))
    return checks
  }

  function run(payload = {}) {
    const cwd = payload.cwd || ''
    const model = payload.model || ''
    const root = projectRoot()
    const checks = []

    const cli = cliRunner.version()
    checks.push(check(
      'cli',
      'CLI OPC',
      cli.ok ? 'ok' : 'error',
      cli.ok ? `CLI détecté ${cli.version || ''}`.trim() : cli.error || 'CLI indisponible.',
      { node: cli.node, cli: cli.cli, version: cli.version },
    ))

    const runtime = cliRunner.runtimeStatus?.() || {}
    const tracked = Array.isArray(runtime.tracked) ? runtime.tracked.length : 0
    checks.push(check(
      'runtime',
      'Runtime actif',
      runtime.active ? 'warning' : 'ok',
      runtime.active ? `Tâche active PID ${runtime.active.pid || 'inconnu'}.` : tracked ? `${tracked} tâche(s) suivie(s), aucune active.` : 'Aucune tâche active.',
      { active: runtime.active || null, tracked },
    ))

    const memory = memoryStore.info()
    checks.push(check(
      'memory',
      'Mémoire durable',
      memory.enabled ? 'ok' : 'warning',
      memory.enabled ? `${memory.recentCount || 0} entrée(s) récentes.` : memory.error || 'Mémoire indisponible.',
      { path: memory.path, recentPath: memory.recentPath, recentCount: memory.recentCount || 0 },
    ))

    checks.push(...providerChecks(model))
    checks.push(gitHygieneCheck('workspace-git', 'Git du dossier sélectionné', cwd))
    checks.push(gitHygieneCheck('app-source-git', 'Git du runtime OPC', root))

    const state = desktopStateStore.read()
    checks.push(check(
      'state',
      'Sauvegarde desktop',
      state.ok ? 'ok' : 'warning',
      state.ok ? 'État local lisible.' : state.error || 'Aucun état desktop encore sauvegardé.',
    ))

    if (process.platform === 'darwin') {
      const appStat = safeStat(appPath)
      const packagedCli = path.join(appPath, 'Contents', 'Resources', 'opc', 'package', 'cli.js')
      const packagedCliStat = safeStat(packagedCli)
      checks.push(check(
        'installed-app',
        'App installée',
        appStat?.isDirectory() && packagedCliStat?.isFile() ? 'ok' : 'warning',
        appStat?.isDirectory()
          ? packagedCliStat?.isFile()
            ? '/Applications/OPC.app contient le CLI packagé.'
            : '/Applications/OPC.app existe, mais le CLI packagé est introuvable.'
          : '/Applications/OPC.app introuvable.',
        { appPath, packagedCli },
      ))
      const runtime = appRuntime(appPath)
      checks.push(check(
        'installed-app-runtime',
        'App installée en exécution',
        runtime.running ? 'warning' : 'ok',
        runtime.running
          ? `OPC.app tourne déjà: PID ${runtime.pids.join(', ')}. Ne remplace pas le bundle pendant l'exécution.`
          : 'OPC.app installée inactive: rebuild/install possible après validation.',
        { appPath, pids: runtime.pids || [], processes: runtime.processes || [], error: runtime.error || '' },
      ))
      const trust = releaseTrust(appPath)
      checks.push(check(
        'release-trust',
        'Trust release macOS',
        trust.status || 'warning',
        trust.detail || 'Signature/notarization non vérifiée.',
        trust.meta || { appPath },
      ))
    }

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      cwd,
      model,
      projectRoot: root,
      summary: summarize(checks),
      checks,
    }
  }

  return { run }
}

module.exports = {
  appRuntimeStatus,
  createDoctor,
  parseGitStatus,
  releaseTrustStatus,
  summarize,
}
