const fs = require('node:fs')
const path = require('node:path')

const MAX_PROJECT_FILE_PREVIEW_BYTES = 160 * 1024
const MAX_PROJECT_FOLDER_FILES = 240
const MAX_PROJECT_FOLDER_CANDIDATES = 1200
const MAX_PROJECT_FOLDER_DEPTH = 8
const MAX_PROJECT_FOLDER_FILE_BYTES = 1024 * 1024

const IGNORED_DIRS = new Set([
  '.cache',
  '.git',
  '.hg',
  '.next',
  '.nuxt',
  '.svn',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'DerivedData',
  'dist',
  'node_modules',
  'out',
  'target',
  'venv',
])

const IGNORED_FILES = new Set(['.DS_Store', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'])
const SECRET_EXTENSIONS = new Set(['.key', '.pem', '.p12', '.pfx', '.crt', '.cer'])
const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.cxx',
  '.go',
  '.graphql',
  '.h',
  '.hpp',
  '.htm',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.less',
  '.lock',
  '.log',
  '.lua',
  '.m',
  '.md',
  '.mdx',
  '.mm',
  '.php',
  '.plist',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
])

function safeProjectFilePath(value) {
  return String(value || '').replace(/\u0000/g, '').trim()
}

function projectFileMetadata(filePath, options = {}) {
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) return null
  if (options.requireReadable && projectFileReadIssue(filePath, stat)) return null
  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
  }
}

function isLikelyTextFile(filePath, stat) {
  const name = path.basename(filePath)
  if (IGNORED_FILES.has(name)) return false
  if (name.startsWith('.env')) return false
  const extension = path.extname(name).toLowerCase()
  if (SECRET_EXTENSIONS.has(extension)) return false
  if (stat.size > MAX_PROJECT_FOLDER_FILE_BYTES) return false
  if (!extension && /^(README|LICENSE|Dockerfile|Makefile|AGENTS|CLAUDE|GEMINI|QWEN|CODEX)$/i.test(name)) return true
  return TEXT_EXTENSIONS.has(extension)
}

function projectFileReadIssue(filePath, stat = null) {
  const safePath = safeProjectFilePath(filePath)
  if (!safePath) return 'Chemin de fichier manquant.'
  const name = path.basename(safePath)
  const fileStat = stat || fs.statSync(safePath)
  if (!fileStat.isFile()) return 'Ce chemin ne pointe pas vers un fichier.'
  if (name.startsWith('.env')) return 'Fichier de secrets refusé.'
  const extension = path.extname(name).toLowerCase()
  if (SECRET_EXTENSIONS.has(extension)) return 'Extension de secret refusée.'
  if (fileStat.size > MAX_PROJECT_FOLDER_FILE_BYTES) return 'Fichier trop volumineux.'
  if (!isLikelyTextFile(safePath, fileStat)) return 'Fichier non textuel ou non supporté.'
  return ''
}

function realProjectPath(filePath) {
  const safePath = safeProjectFilePath(filePath)
  if (!safePath) return ''
  return fs.realpathSync(safePath)
}

function isPathInside(child, parent) {
  const relative = path.relative(parent, child)
  return relative === '' || Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function createProjectFileAccessRegistry() {
  const files = new Set()
  const roots = new Set()

  function authorizeFile(filePath) {
    try {
      const realPath = realProjectPath(filePath)
      if (realPath) files.add(realPath)
      return realPath
    } catch {
      return ''
    }
  }

  function authorizeFiles(items = []) {
    for (const item of items) {
      authorizeFile(typeof item === 'string' ? item : item?.path)
    }
  }

  function authorizeRoot(rootPath) {
    try {
      const realPath = realProjectPath(rootPath)
      const stat = fs.statSync(realPath)
      if (stat.isDirectory()) roots.add(realPath)
      return realPath
    } catch {
      return ''
    }
  }

  function authorizeState(state = {}) {
    const projects = Array.isArray(state?.projects) ? state.projects : []
    for (const project of projects) authorizeFiles(project?.files || [])
  }

  function isAuthorized(filePath) {
    try {
      const realPath = realProjectPath(filePath)
      if (files.has(realPath)) return true
      for (const root of roots) {
        if (isPathInside(realPath, root)) return true
      }
      return false
    } catch {
      return false
    }
  }

  return {
    authorizeFile,
    authorizeFiles,
    authorizeRoot,
    authorizeState,
    isAuthorized,
    snapshot: () => ({ files: Array.from(files), roots: Array.from(roots) }),
  }
}

function projectFilePriority(filePath) {
  const normalized = filePath.split(path.sep).join('/')
  const name = path.basename(filePath)
  if (name === 'CLAUDE.md') return 0
  if (name === 'AGENTS.md') return 1
  if (/\/\.claude\/settings\.json$/i.test(normalized)) return 2
  if (/\/\.claude\/[^/]+\.md$/i.test(normalized)) return 3
  if (/\/\.mcp\.json$/i.test(normalized) || name === '.mcp.json') return 4
  if (/^(GEMINI|QWEN|CODEX)\.md$/i.test(name)) return 5
  if (/\/skills\/[^/]+\/SKILL\.md$/i.test(normalized)) return 6
  if (/\/agents\/[^/]+\.md$/i.test(normalized)) return 7
  if (/\/\.claude-plugin\/plugin\.json$/i.test(normalized)) return 8
  if (/\/hooks\/hooks\.json$/i.test(normalized)) return 9
  if (/^(README|QUICKSTART|CONNECTORS)\.md$/i.test(name)) return 10
  if (/\.mdx?$/i.test(name)) return 8
  if (/\.(json|ya?ml|toml)$/i.test(name)) return 10
  return 20
}

function scanProjectFolder(rootPath, options = {}) {
  const root = safeProjectFilePath(rootPath)
  const limit = Math.min(Math.max(Number(options.limit) || MAX_PROJECT_FOLDER_FILES, 1), MAX_PROJECT_FOLDER_FILES)
  const maxDepth = Math.min(Math.max(Number(options.maxDepth) || MAX_PROJECT_FOLDER_DEPTH, 1), MAX_PROJECT_FOLDER_DEPTH)
  const candidateLimit = Math.min(Math.max(Number(options.candidateLimit) || MAX_PROJECT_FOLDER_CANDIDATES, limit), MAX_PROJECT_FOLDER_CANDIDATES)
  const candidates = []
  const skipped = { directories: 0, files: 0, oversized: 0, binary: 0 }
  const seen = new Set()

  function walk(dir, depth) {
    if (candidates.length >= candidateLimit || depth > maxDepth) return
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      skipped.directories += 1
      return
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (candidates.length >= candidateLimit) break
      if (entry.name.startsWith('.') && !['.github', '.claude', '.claude-plugin', '.mcp.json'].includes(entry.name)) {
        if (entry.isDirectory()) skipped.directories += 1
        else skipped.files += 1
        continue
      }
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          skipped.directories += 1
          continue
        }
        walk(fullPath, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      let stat
      try {
        stat = fs.statSync(fullPath)
      } catch {
        skipped.files += 1
        continue
      }
      if (stat.size > MAX_PROJECT_FOLDER_FILE_BYTES) {
        skipped.oversized += 1
        continue
      }
      if (!isLikelyTextFile(fullPath, stat)) {
        skipped.binary += 1
        continue
      }
      if (seen.has(fullPath)) continue
      seen.add(fullPath)
      candidates.push(projectFileMetadata(fullPath))
    }
  }

  const stat = fs.statSync(root)
  if (!stat.isDirectory()) return { root, files: [], skipped, error: 'Ce chemin ne pointe pas vers un dossier.' }
  walk(root, 0)
  const files = candidates
    .filter(Boolean)
    .sort((a, b) => projectFilePriority(a.path) - projectFilePriority(b.path) || a.path.localeCompare(b.path))
    .slice(0, limit)
  return { root, files: files.filter(Boolean), skipped, limitReached: files.length >= limit }
}

function readProjectFile(filePath, maxBytes = MAX_PROJECT_FILE_PREVIEW_BYTES) {
  const safePath = safeProjectFilePath(filePath)
  if (!safePath) return { ok: false, error: 'Chemin de fichier manquant.' }
  try {
    const metadata = projectFileMetadata(safePath)
    if (!metadata) return { ok: false, path: safePath, error: 'Ce chemin ne pointe pas vers un fichier.' }
    const issue = projectFileReadIssue(safePath)
    if (issue) return { ok: false, path: safePath, error: issue }
    const bytesLimit = Math.min(Math.max(Number(maxBytes) || MAX_PROJECT_FILE_PREVIEW_BYTES, 1024), MAX_PROJECT_FILE_PREVIEW_BYTES)
    const buffer = Buffer.alloc(Math.min(metadata.size, bytesLimit))
    const fd = fs.openSync(safePath, 'r')
    let bytesRead = 0
    try {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
    } finally {
      fs.closeSync(fd)
    }
    const content = buffer.subarray(0, bytesRead).toString('utf8').replace(/\u0000/g, '')
    return {
      ok: true,
      ...metadata,
      content,
      truncated: metadata.size > bytesRead,
    }
  } catch (error) {
    return { ok: false, path: safePath, error: error.message }
  }
}

module.exports = {
  MAX_PROJECT_FILE_PREVIEW_BYTES,
  MAX_PROJECT_FOLDER_FILES,
  createProjectFileAccessRegistry,
  projectFileMetadata,
  projectFileReadIssue,
  projectFilePriority,
  readProjectFile,
  safeProjectFilePath,
  scanProjectFolder,
}
