import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getProjectRoot } from '../bootstrap/state.js'

export function getMemoryFilePath(): string {
  return join(getProjectRoot(), '.claude', 'memory.md')
}

export function getMemory(): string {
  const memoryPath = getMemoryFilePath()
  if (!existsSync(memoryPath)) {
    return ''
  }
  return readFileSync(memoryPath, { encoding: 'utf-8' })
}

export function saveMemory(content: string): void {
  const memoryPath = getMemoryFilePath()
  const dir = join(getProjectRoot(), '.claude')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(memoryPath, content, 'utf-8')
}

export function appendMemory(title: string, summary: string): void {
  const currentMemory = getMemory()
  const dateStr = new Date().toISOString().split('T')[0]
  const newSection = `\n## [${dateStr}] ${title}\n\n${summary}\n`
  saveMemory(currentMemory + newSection)
}
