import * as React from 'react';
import { handlePlanModeTransition } from '../../bootstrap/state.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { Box, Text } from '../../ink.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getExternalEditor } from '../../utils/editor.js';
import { toIDEDisplayName } from '../../utils/ide.js';
import { applyPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js';
import { prepareContextForPlanMode } from '../../utils/permissions/permissionSetup.js';
import { getPlan, getPlanFilePath } from '../../utils/plans.js';
import { editFileInEditor } from '../../utils/promptEditor.js';
import { renderToString } from '../../utils/staticRender.js';
import { initTasks, getTasks, saveTasks, TaskItem } from '../../utils/taskChecklist.js';

interface PlanDisplayProps {
  planContent: string;
  planPath: string;
  editorName?: string;
  tasks: TaskItem[];
}

function PlanDisplay({ planContent, planPath, editorName, tasks }: PlanDisplayProps) {
  const taskList = tasks.length > 0 ? (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Tâches ({tasks.filter(t => t.status === 'done').length}/{tasks.length}) :</Text>
      {tasks.map((t, i) => {
        let mark = '[ ]';
        if (t.status === 'done') mark = '[x]';
        if (t.status === 'in_progress') mark = '[/]';
        return (
          <Text key={i}>
            <Text bold={t.status === 'in_progress'} dimColor={t.status === 'done'}>
              {i}: {mark} {t.text}
            </Text>
          </Text>
        );
      })}
    </Box>
  ) : null;

  return (
    <Box flexDirection="column">
      <Text bold>Plan Actuel</Text>
      <Text dimColor={true}>{planPath}</Text>
      <Box marginTop={1}>
        <Text>{planContent}</Text>
      </Box>
      {taskList}
      {editorName && (
        <Box marginTop={1}>
          <Text dimColor={true}>"/plan open"</Text>
          <Text dimColor={true}> to edit this plan in </Text>
          <Text bold={true} dimColor={true}>{editorName}</Text>
        </Box>
      )}
    </Box>
  );
}

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args: string): Promise<React.ReactNode> {
  const {
    getAppState,
    setAppState
  } = context;
  const appState = getAppState();
  const currentMode = appState.toolPermissionContext.mode;

  // If not in plan mode, enable it
  if (currentMode !== 'plan') {
    handlePlanModeTransition(currentMode, 'plan');
    setAppState(prev => ({
      ...prev,
      toolPermissionContext: applyPermissionUpdate(prepareContextForPlanMode(prev.toolPermissionContext), {
        type: 'setMode',
        mode: 'plan',
        destination: 'session'
      })
    }));

    const description = args.trim();
    // Initialize task and plan files
    initTasks(description && description !== 'open' ? description : undefined);

    if (description && description !== 'open') {
      onDone('Enabled plan mode', {
        shouldQuery: true
      });
    } else {
      onDone('Enabled plan mode');
    }
    return null;
  }

  // Already in plan mode - parse arguments
  const argList = args.trim().split(/\s+/);
  const command = argList[0]?.toLowerCase();

  if (command === 'status') {
    const tasks = getTasks();
    if (tasks.length === 0) {
      onDone('Aucune tâche définie dans .claude/task.md');
      return null;
    }
    let statusText = 'Statut des tâches :\n';
    tasks.forEach((t, i) => {
      let mark = '[ ]';
      if (t.status === 'done') mark = '[x]';
      if (t.status === 'in_progress') mark = '[/]';
      statusText += `${i}: ${mark} ${t.text}\n`;
    });
    onDone(statusText);
    return null;
  }

  if (command === 'task') {
    const subCommand = argList[1]?.toLowerCase();
    const taskName = argList.slice(2).join(' ').trim();
    if (!subCommand || !taskName) {
      onDone('Usage: /plan task [add|toggle|done|todo|progress] <nom de la tâche ou index>');
      return null;
    }

    const tasks = getTasks();
    if (subCommand === 'add') {
      tasks.push({ text: taskName, status: 'todo' });
      saveTasks(tasks);
      onDone(`Tâche ajoutée : ${taskName}`);
      return null;
    }

    if (['toggle', 'done', 'todo', 'progress'].includes(subCommand)) {
      const index = parseInt(taskName, 10);
      let targetTask = tasks.find(t => t.text.toLowerCase() === taskName.toLowerCase());
      if (!targetTask && !isNaN(index) && index >= 0 && index < tasks.length) {
        targetTask = tasks[index];
      }

      if (!targetTask) {
        onDone(`Tâche non trouvée : ${taskName}`);
        return null;
      }

      if (subCommand === 'toggle') {
        targetTask.status = targetTask.status === 'done' ? 'todo' : (targetTask.status === 'todo' ? 'in_progress' : 'done');
      } else if (subCommand === 'done') {
        targetTask.status = 'done';
      } else if (subCommand === 'todo') {
        targetTask.status = 'todo';
      } else if (subCommand === 'progress') {
        targetTask.status = 'in_progress';
      }

      saveTasks(tasks);
      onDone(`Statut mis à jour pour : ${targetTask.text} (${targetTask.status})`);
      return null;
    }
  }

  // Show the current plan and tasks
  const planContent = getPlan();
  const planPath = getPlanFilePath();
  const tasks = getTasks();

  if (!planContent) {
    onDone('Already in plan mode. No plan written yet.');
    return null;
  }

  // If user typed "/plan open", open in editor
  if (command === 'open') {
    const result = await editFileInEditor(planPath);
    if (result.error) {
      onDone(`Failed to open plan in editor: ${result.error}`);
    } else {
      onDone(`Opened plan in editor: ${planPath}`);
    }
    return null;
  }

  const editor = getExternalEditor();
  const editorName = editor ? toIDEDisplayName(editor) : undefined;
  const display = <PlanDisplay planContent={planContent} planPath={planPath} editorName={editorName} tasks={tasks} />;

  // Render to string and pass to onDone like local commands do
  const output = await renderToString(display);
  onDone(output);
  return null;
}