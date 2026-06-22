import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getProjectRoot } from '../bootstrap/state.js'

export type TaskStatus = 'todo' | 'in_progress' | 'done'

export interface TaskItem {
  text: string
  status: TaskStatus
}

export function getTasksFilePath(): string {
  return join(getProjectRoot(), '.claude', 'task.md')
}

export function getImplementationPlanFilePath(): string {
  return join(getProjectRoot(), '.claude', 'implementation_plan.md')
}

export function initTasks(planDescription?: string): void {
  const claudeDir = join(getProjectRoot(), '.claude')
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true })
  }

  const taskPath = getTasksFilePath()
  if (!existsSync(taskPath)) {
    const initialContent = `# Tasks\n\n- [ ] Planifier les modifications\n- [ ] Implémenter le code\n- [ ] Valider l'implémentation\n`
    writeFileSync(taskPath, initialContent, 'utf-8')
  }

  const planPath = getImplementationPlanFilePath()
  if (!existsSync(planPath)) {
    const initialPlan = `# Plan d'implémentation\n\n${planDescription || 'Description du plan...'}\n`
    writeFileSync(planPath, initialPlan, 'utf-8')
  }
}

export function getTasks(): TaskItem[] {
  const taskPath = getTasksFilePath()
  if (!existsSync(taskPath)) {
    return []
  }

  const content = readFileSync(taskPath, { encoding: 'utf-8' })
  const lines = content.split('\n')
  const tasks: TaskItem[] = []

  for (const line of lines) {
    const match = line.match(/^\s*-\s*\[([\sxX/])\]\s*(.*)$/)
    if (match) {
      const statusChar = match[1]!.toLowerCase()
      const text = match[2]!.trim()
      let status: TaskStatus = 'todo'
      if (statusChar === 'x') {
        status = 'done'
      } else if (statusChar === '/') {
        status = 'in_progress'
      }
      tasks.push({ text, status })
    }
  }

  return tasks
}

export function saveTasks(tasks: TaskItem[]): void {
  const taskPath = getTasksFilePath()
  
  let content = '# Tasks\n\n'
  for (const task of tasks) {
    let statusStr = ' '
    if (task.status === 'done') {
      statusStr = 'x'
    } else if (task.status === 'in_progress') {
      statusStr = '/'
    }
    content += `- [${statusStr}] ${task.text}\n`
  }

  writeFileSync(taskPath, content, 'utf-8')
}
