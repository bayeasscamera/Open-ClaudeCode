const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const SCREEN_DELAY_MS = 120
const STEP_TIMEOUT_MS = 12000
const VISUAL_TIMEOUT_MS = 90000
const MIN_SCREEN_CONTRAST = 27.95

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withTimeout(label, promise, timeoutMs = STEP_TIMEOUT_MS) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function rendererEval(window, script, label = 'renderer evaluation') {
  return withTimeout(label, window.webContents.executeJavaScript(script))
}

async function waitForSelector(window, selector, label = selector) {
  return rendererEval(window, `
    (async () => {
      const startedAt = Date.now()
      while (Date.now() - startedAt < ${STEP_TIMEOUT_MS}) {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (el) {
          const rect = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0) {
            return true
          }
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('selector not visible: ${selector}')
    })()
  `, `wait for ${label}`)
}

async function waitForPaint() {
  await sleep(SCREEN_DELAY_MS)
}

function visualArtifactDir() {
  const configured = process.env.OPC_E2E_VISUAL_DIR
  const target = configured || fs.mkdtempSync(path.join(os.tmpdir(), 'opc-visual-'))
  fs.mkdirSync(target, { recursive: true })
  return target
}

function colorMetrics(image) {
  const size = image.getSize()
  const bitmap = image.toBitmap()
  const pixelCount = Math.max(1, size.width * size.height)
  const stride = Math.max(4, Math.floor(pixelCount / 18000) * 4)
  let samples = 0
  let dark = 0
  let light = 0
  let accent = 0
  let sum = 0
  let sumSq = 0
  const buckets = new Set()

  for (let i = 0; i + 3 < bitmap.length; i += stride) {
    const b = bitmap[i]
    const g = bitmap[i + 1]
    const r = bitmap[i + 2]
    const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b)
    samples += 1
    sum += luma
    sumSq += luma * luma
    if (luma < 55) dark += 1
    if (luma > 238) light += 1
    if (r > 170 && g > 65 && g < 165 && b < 95) accent += 1
    buckets.add(`${r >> 5}.${g >> 5}.${b >> 5}`)
  }

  const average = sum / Math.max(1, samples)
  const variance = (sumSq / Math.max(1, samples)) - (average * average)
  return {
    width: size.width,
    height: size.height,
    samples,
    average: Number(average.toFixed(2)),
    contrast: Number(Math.sqrt(Math.max(0, variance)).toFixed(2)),
    darkRatio: Number((dark / Math.max(1, samples)).toFixed(4)),
    lightRatio: Number((light / Math.max(1, samples)).toFixed(4)),
    accentRatio: Number((accent / Math.max(1, samples)).toFixed(4)),
    colorBuckets: buckets.size,
  }
}

function assertPixelHealth(name, metrics) {
  if (metrics.width < 980 || metrics.height < 660) {
    throw new Error(`${name}: viewport too small ${metrics.width}x${metrics.height}`)
  }
  if (metrics.contrast < MIN_SCREEN_CONTRAST) {
    throw new Error(`${name}: screenshot looks too flat, contrast=${metrics.contrast}`)
  }
  if (metrics.darkRatio < 0.08) {
    throw new Error(`${name}: dark shell/sidebar is missing, darkRatio=${metrics.darkRatio}`)
  }
  if (metrics.lightRatio > 0.86) {
    throw new Error(`${name}: screenshot is too blank/light, lightRatio=${metrics.lightRatio}`)
  }
  if (metrics.accentRatio < 0.002) {
    throw new Error(`${name}: OPC accent color is missing, accentRatio=${metrics.accentRatio}`)
  }
  if (metrics.colorBuckets < 24) {
    throw new Error(`${name}: not enough visual variety, buckets=${metrics.colorBuckets}`)
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatRatio(value) {
  return `${Math.round(Number(value) * 1000) / 10}%`
}

function metricRows(metrics) {
  return [
    ['Taille', `${metrics.width} x ${metrics.height}`],
    ['Contraste', metrics.contrast],
    ['Sombre', formatRatio(metrics.darkRatio)],
    ['Clair', formatRatio(metrics.lightRatio)],
    ['Accent OPC', formatRatio(metrics.accentRatio)],
    ['Palette', `${metrics.colorBuckets} groupes`],
  ]
}

function layoutRows(layout) {
  return Object.entries(layout)
    .filter(([, box]) => box)
    .map(([name, box]) => `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td>${box.visible ? 'visible' : 'masque'}</td>
        <td>${box.x}, ${box.y}</td>
        <td>${box.width} x ${box.height}</td>
      </tr>
    `)
    .join('')
}

function writeVisualReport(artifactDir, screens) {
  const reportPath = path.join(artifactDir, 'visual-report.html')
  const jsonPath = path.join(artifactDir, 'visual-report.json')
  const generatedAt = new Date().toISOString()
  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt, screens }, null, 2))
  fs.writeFileSync(reportPath, `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OPC Visual QA</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f4ef;
      --panel: #fffdfa;
      --ink: #181512;
      --muted: #746f67;
      --line: #e6ded3;
      --accent: #e76f2f;
      --accent-soft: #fff0e7;
      --ok: #2f8f55;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      margin: 0;
      background: radial-gradient(circle at 20% 0%, #fff 0, var(--bg) 420px);
      color: var(--ink);
    }
    .page {
      max-width: 1180px;
      margin: 0 auto;
      padding: 34px 28px 56px;
    }
    .hero {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: flex-start;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 34px;
      letter-spacing: 0;
    }
    .subtitle {
      color: var(--muted);
      font-size: 15px;
      line-height: 1.5;
    }
    .status {
      border: 1px solid #cce6d5;
      background: #eef9f2;
      color: var(--ok);
      border-radius: 999px;
      padding: 8px 14px;
      font-weight: 800;
      white-space: nowrap;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .summaryCard,
    .screen {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 18px;
      box-shadow: 0 18px 60px rgba(38, 26, 16, 0.08);
    }
    .summaryCard {
      padding: 16px;
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .value {
      margin-top: 6px;
      font-size: 20px;
      font-weight: 850;
    }
    .screen {
      overflow: hidden;
      margin: 18px 0;
    }
    .screenHeader {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 20px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #fffaf6 0%, #fffdfa 100%);
    }
    .screenTitle {
      font-size: 20px;
      font-weight: 850;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      border: 1px solid #ffd3b9;
      background: var(--accent-soft);
      color: #9d4218;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 800;
    }
    .screenBody {
      display: grid;
      grid-template-columns: minmax(0, 1.6fr) minmax(260px, 0.9fr);
      gap: 18px;
      padding: 18px;
    }
    .shot {
      width: 100%;
      display: block;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: #fff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th,
    td {
      text-align: left;
      padding: 9px 8px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .sectionTitle {
      margin: 0 0 10px;
      font-size: 13px;
      font-weight: 850;
      text-transform: uppercase;
      color: var(--muted);
      letter-spacing: 0.04em;
    }
    .metrics,
    .layout {
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fffaf5;
      margin-bottom: 14px;
    }
    @media (max-width: 860px) {
      .hero,
      .screenHeader {
        display: block;
      }
      .status {
        display: inline-flex;
        margin-top: 12px;
      }
      .summary,
      .screenBody {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div>
        <h1>OPC Visual QA</h1>
        <div class="subtitle">Rapport genere automatiquement apres capture Electron. Chaque ecran doit rester lisible, contraste, sans debordement horizontal et avec les zones critiques visibles.</div>
      </div>
      <div class="status">Validation OK</div>
    </section>
    <section class="summary">
      <div class="summaryCard"><div class="label">Ecrans</div><div class="value">${screens.length}</div></div>
      <div class="summaryCard"><div class="label">Genere</div><div class="value">${escapeHtml(generatedAt.slice(0, 19).replace('T', ' '))}</div></div>
      <div class="summaryCard"><div class="label">Contraste min</div><div class="value">${Math.min(...screens.map(screen => screen.metrics.contrast))}</div></div>
      <div class="summaryCard"><div class="label">Palette min</div><div class="value">${Math.min(...screens.map(screen => screen.metrics.colorBuckets))}</div></div>
    </section>
    ${screens.map((screen, index) => `
      <section class="screen">
        <div class="screenHeader">
          <div>
            <div class="label">Capture ${String(index + 1).padStart(2, '0')}</div>
            <div class="screenTitle">${escapeHtml(screen.name)}</div>
          </div>
          <div class="badge">Contraste ${screen.metrics.contrast}</div>
        </div>
        <div class="screenBody">
          <img class="shot" src="${escapeHtml(path.basename(screen.screenshot))}" alt="${escapeHtml(screen.name)}">
          <div>
            <div class="metrics">
              <div class="sectionTitle">Metriques visuelles</div>
              <table>
                <tbody>
                  ${metricRows(screen.metrics).map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div class="layout">
              <div class="sectionTitle">Zones UI detectees</div>
              <table>
                <thead><tr><th>Zone</th><th>Etat</th><th>Position</th><th>Taille</th></tr></thead>
                <tbody>${layoutRows(screen.layout)}</tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    `).join('')}
  </main>
</body>
</html>
`)
  return { report: reportPath, reportData: jsonPath }
}

async function domSnapshot(window) {
  return rendererEval(window, `
    (() => {
      const box = selector => {
        const el = document.querySelector(selector)
        if (!el) return null
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
        }
      }
      const activeScope = document.querySelector('#settingsModal:not(.hidden)')
        || document.querySelector('#projectModal:not(.hidden)')
        || document.querySelector('#logsPanel:not(.hidden)')
        || document.body
      const fieldText = Array.from(activeScope.querySelectorAll('input, textarea, select'))
        .map(el => {
          if (el.tagName === 'SELECT') return el.options[el.selectedIndex]?.textContent || el.value || ''
          return el.value || el.placeholder || ''
        })
        .join(' ')
      const bodyText = activeScope === document.body
        ? document.body.innerText
        : activeScope.innerText + ' ' + document.body.innerText
      return {
        title: document.title,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        text: (bodyText + ' ' + fieldText).replace(/\\s+/g, ' ').trim().slice(0, 8000),
        counts: {
          chats: document.querySelectorAll('.chatItemWrap').length,
          projects: document.querySelectorAll('.projectItemWrap').length,
          projectPanels: document.querySelectorAll('.projectContextPanel').length,
          activityPanels: document.querySelectorAll('.activityPanel').length
        },
        boxes: {
          app: box('#app'),
          sidebar: box('.sidebar'),
          topbar: box('.topbar'),
          messages: box('#messages'),
          composer: box('.composerBox'),
          modal: box('#projectModal:not(.hidden) .projectModal'),
          settingsDialog: box('#settingsModal:not(.hidden) .settingsDialog'),
          projectPanel: box('.projectContextPanel'),
          logsPanel: box('#logsPanel:not(.hidden)')
        }
      }
    })()
  `, 'dom snapshot')
}

function assertBox(name, dom, key, minWidth, minHeight) {
  const box = dom.boxes[key]
  if (!box?.visible) throw new Error(`${name}: missing visible ${key}`)
  if (box.width < minWidth || box.height < minHeight) {
    throw new Error(`${name}: ${key} too small ${box.width}x${box.height}`)
  }
  return box
}

function assertDomHealth(name, dom, expectations = {}) {
  if (dom.title !== 'OPC') throw new Error(`${name}: wrong title ${dom.title}`)
  if (dom.scrollWidth > dom.innerWidth + 1) {
    throw new Error(`${name}: horizontal overflow ${dom.scrollWidth} > ${dom.innerWidth}`)
  }
  assertBox(name, dom, 'sidebar', 318, 500)
  assertBox(name, dom, 'topbar', 520, 70)
  assertBox(name, dom, 'messages', 360, 220)
  assertBox(name, dom, 'composer', 360, 48)

  const normalizedText = dom.text.toLocaleLowerCase('fr')
  for (const expectedText of expectations.text || []) {
    if (!normalizedText.includes(String(expectedText).toLocaleLowerCase('fr'))) {
      throw new Error(`${name}: missing text "${expectedText}" in "${dom.text.slice(0, 800)}"`)
    }
  }

  if (expectations.modal) assertBox(name, dom, 'modal', 320, 360)
  if (expectations.settingsDialog) assertBox(name, dom, 'settingsDialog', 520, 420)
  if (expectations.projectPanel) assertBox(name, dom, 'projectPanel', 520, 260)
  if (expectations.logsPanel) assertBox(name, dom, 'logsPanel', 360, 500)
}

async function captureScreen(window, artifactDir, index, name, expectations) {
  await waitForPaint(window)
  const dom = await domSnapshot(window)
  assertDomHealth(name, dom, expectations)
  const image = await withTimeout(`capture ${name}`, window.webContents.capturePage())
  const screenshot = path.join(artifactDir, `${String(index).padStart(2, '0')}-${name}.png`)
  fs.writeFileSync(screenshot, image.toPNG())
  const metrics = colorMetrics(image)
  assertPixelHealth(name, metrics)
  return {
    name,
    screenshot,
    metrics,
    layout: {
      sidebar: dom.boxes.sidebar,
      topbar: dom.boxes.topbar,
      messages: dom.boxes.messages,
      composer: dom.boxes.composer,
      modal: dom.boxes.modal,
      settingsDialog: dom.boxes.settingsDialog,
      projectPanel: dom.boxes.projectPanel,
      logsPanel: dom.boxes.logsPanel,
    },
  }
}

async function openProjectModal(window) {
  await rendererEval(window, `
    (() => {
      const button = document.querySelector('#newProject')
      if (!button) throw new Error('new project button missing')
      button.click()
    })()
  `, 'open project modal')
  await waitForSelector(window, '#projectModal:not(.hidden) #projectNameInput', 'project modal')
  await rendererEval(window, `
    (() => {
      document.querySelector('#projectNameInput').value = 'QA Visuelle'
      document.querySelector('#projectDescriptionInput').value = 'Projet de contrôle visuel automatisé'
      document.querySelector('#projectMemoryInput').value = 'Préférer une interface dense, lisible et stable.'
      document.querySelector('#projectInstructionsInput').value = 'Afficher clairement les étapes, outils et fichiers utilisés.'
    })()
  `, 'fill project modal')
}

async function submitProjectAndCreateChat(window) {
  await rendererEval(window, `
    (() => {
      const form = document.querySelector('#projectForm')
      if (!form) throw new Error('project form missing')
      form.requestSubmit()
    })()
  `, 'submit project')
  await waitForSelector(window, '.projectContextPanel', 'project context panel')
  await rendererEval(window, `
    (() => {
      const button = document.querySelector('#newChat')
      if (!button) throw new Error('new chat button missing')
      button.click()
      const messages = document.querySelector('#messages')
      if (messages) messages.scrollTop = 0
    })()
  `, 'create chat for project')
}

async function openInspector(window) {
  await rendererEval(window, `
    (() => {
      const logs = document.querySelector('#logsPanel')
      const toggle = document.querySelector('#logsToggle')
      if (!logs || !toggle) throw new Error('inspector controls missing')
      if (logs.classList.contains('hidden')) toggle.click()
      const messages = document.querySelector('#messages')
      if (messages) messages.scrollTop = 0
    })()
  `, 'open inspector')
  await waitForSelector(window, '#logsPanel:not(.hidden)', 'logs panel')
}

async function openSettings(window) {
  await rendererEval(window, `
    (() => {
      const toggle = document.querySelector('#settingsToggle')
      if (!toggle) throw new Error('settings button missing')
      toggle.click()
    })()
  `, 'open settings')
  await waitForSelector(window, '#settingsModal:not(.hidden)', 'settings modal')
  await rendererEval(window, `
    (() => {
      const tab = document.querySelector('[data-settings-tab="providers"]')
      if (!tab) throw new Error('providers settings tab missing')
      tab.click()
    })()
  `, 'open provider settings tab')
  await waitForSelector(window, '[data-settings-panel="providers"].active', 'provider settings panel')
}

async function openProviderEditor(window) {
  await rendererEval(window, `
    (() => {
      document.querySelector('#settingsSearchInput').value = ''
      document.querySelector('#settingsSearchInput').dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('[data-settings-tab="providers"]').click()
      document.querySelector('#settingsAddProvider').click()
      document.querySelector('#settingsProviderModel').value = 'qa/provider-model'
      document.querySelector('#settingsProviderBaseUrl').value = 'http://localhost:8317/v1'
    })()
  `, 'open provider editor')
  await waitForSelector(window, '#settingsProviderEditor:not(.hidden)', 'provider editor')
}

async function openProviderImport(window) {
  await rendererEval(window, `
    (() => {
      const search = document.querySelector('#settingsSearchInput')
      if (search) {
        search.value = ''
        search.dispatchEvent(new Event('input', { bubbles: true }))
      }
      document.querySelector('[data-settings-tab="providers"]')?.click()
      const button = document.querySelector('#settingsImportProviders')
      if (!button) throw new Error('provider import button missing')
      button.scrollIntoView({ block: 'center' })
      button.click()
    })()
  `, 'open provider import')
  await waitForSelector(window, '#settingsProviderImportPanel:not(.hidden)', 'provider import panel')
  await rendererEval(window, `
    (() => document.querySelector('#settingsProviderImportPanel')?.scrollIntoView({ block: 'center' }))()
  `, 'scroll provider import panel')
}

async function filterSettingsToProject(window) {
  await rendererEval(window, `
    (() => {
      const input = document.querySelector('#settingsSearchInput')
      input.value = 'instructions'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const projectPanel = document.querySelector('[data-settings-panel="project"]')
      const providersPanel = document.querySelector('[data-settings-panel="providers"]')
      if (!projectPanel?.classList.contains('active')) throw new Error('settings search did not activate project panel')
      if (!providersPanel?.classList.contains('searchHidden')) throw new Error('settings search did not hide provider panel')
    })()
  `, 'filter settings to project')
}

function attachVisualQa(window, app) {
  const timeout = setTimeout(() => {
    console.error('OPC_E2E_VISUAL_FAIL timeout')
    app.exit(1)
  }, VISUAL_TIMEOUT_MS)

  window.webContents.once('did-finish-load', async () => {
    const artifactDir = visualArtifactDir()
    try {
      const screens = []
      screens.push(await captureScreen(window, artifactDir, 1, 'main', {
        text: ['OPC', 'Nouveau chat'],
      }))
      await openProjectModal(window)
      screens.push(await captureScreen(window, artifactDir, 2, 'project-modal', {
        modal: true,
        text: ['Nouveau projet', 'QA Visuelle'],
      }))
      await submitProjectAndCreateChat(window)
      screens.push(await captureScreen(window, artifactDir, 3, 'project-context', {
        projectPanel: true,
        text: ['Projet actif', 'QA Visuelle', 'Mémoire', 'Instructions', 'Fichiers'],
      }))
      await openInspector(window)
      screens.push(await captureScreen(window, artifactDir, 4, 'inspector', {
        logsPanel: true,
        text: ['Inspecteur', 'Flux CLI'],
      }))
      await openSettings(window)
      screens.push(await captureScreen(window, artifactDir, 5, 'settings', {
        settingsDialog: true,
        text: ['Réglages', 'Recherche', 'Runtime', 'Providers', 'Tester sélection', 'Copier JSON sans clés', 'Importer JSON'],
      }))
      await openProviderImport(window)
      screens.push(await captureScreen(window, artifactDir, 6, 'provider-import', {
        settingsDialog: true,
        text: ['Import provider', 'JSON de profil', 'Coller presse-papiers'],
      }))
      await filterSettingsToProject(window)
      screens.push(await captureScreen(window, artifactDir, 7, 'settings-filter-project', {
        settingsDialog: true,
        text: ['Projet actif', 'Nouveau projet'],
      }))
      await openProviderEditor(window)
      screens.push(await captureScreen(window, artifactDir, 8, 'provider-editor', {
        settingsDialog: true,
        text: ['Éditeur provider', 'Nouveau provider', 'Base URL', 'Extra body JSON'],
      }))
      const report = writeVisualReport(artifactDir, screens)
      clearTimeout(timeout)
      console.log(`OPC_E2E_VISUAL_OK ${JSON.stringify({ artifactDir, ...report, screens })}`)
      app.exit(0)
    } catch (error) {
      clearTimeout(timeout)
      console.error(`OPC_E2E_VISUAL_FAIL ${error.stack || error.message}`)
      console.error(`OPC_E2E_VISUAL_ARTIFACTS ${artifactDir}`)
      app.exit(1)
    }
  })
}

module.exports = { attachVisualQa }
