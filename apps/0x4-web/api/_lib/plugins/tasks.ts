/**
 * Plugin: tasks — per-wallet todo list managed by the agent.
 * The user can say "remind me to X", "add to my todo", "what's on my list".
 */
import type { AgentPlugin, ToolResult } from '../plugin.js';
import type { ToolDef } from '../router.js';
import type { PluginContext } from '../plugin.js';

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'add_task',
      description: 'Add a task to the user\'s todo list.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          due: { type: 'string', description: 'Due date/description (optional, e.g. "tomorrow", "2026-10-15")' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: 'List the user\'s tasks (pending and done).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Mark a task as done (by title keyword or index).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Task title keyword or number from list' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Delete a task (by title keyword or index).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Task title keyword or number from list' },
        },
        required: ['query'],
      },
    },
  },
];

interface Task {
  id: number;
  title: string;
  due?: string;
  done: boolean;
  createdAt: number;
}

const store = new Map<string, Task[]>();
let nextId = 1;

function tasksFor(wallet: string): Task[] {
  const w = wallet.toLowerCase();
  let list = store.get(w);
  if (!list) {
    list = [];
    store.set(w, list);
  }
  return list;
}

function findTask(list: Task[], query: string): Task | undefined {
  const q = query.trim().toLowerCase();
  // by index (1-based as shown in list)
  const n = parseInt(q, 10);
  if (!isNaN(n) && n >= 1 && n <= list.length) return list[n - 1];
  return list.find((t) => t.title.toLowerCase().includes(q));
}

export const tasksPlugin: AgentPlugin = {
  name: 'tasks',
  version: '1.0.0',
  description: 'Todo list: add, list, complete, delete tasks',
  tools,

  async execute(toolName: string, args: Record<string, unknown>, ctx?: PluginContext): Promise<ToolResult> {
    const wallet = ctx?.wallet;
    if (!wallet) return { ok: false, error: 'No wallet connected' };
    const list = tasksFor(wallet);

    if (toolName === 'add_task') {
      const title = String(args.title || '').trim().slice(0, 200);
      if (!title) return { ok: false, error: 'Title required' };
      const task: Task = {
        id: nextId++,
        title,
        due: String(args.due || '').slice(0, 100) || undefined,
        done: false,
        createdAt: Date.now(),
      };
      list.push(task);
      return { ok: true, data: { added: task } };
    }

    if (toolName === 'list_tasks') {
      return {
        ok: true,
        data: {
          tasks: list.map((t, i) => ({
            n: i + 1,
            title: t.title,
            due: t.due,
            done: t.done,
          })),
        },
      };
    }

    if (toolName === 'complete_task') {
      const t = findTask(list, String(args.query || ''));
      if (!t) return { ok: false, error: 'Task not found' };
      t.done = true;
      return { ok: true, data: { completed: t.title } };
    }

    if (toolName === 'delete_task') {
      const t = findTask(list, String(args.query || ''));
      if (!t) return { ok: false, error: 'Task not found' };
      const idx = list.indexOf(t);
      list.splice(idx, 1);
      return { ok: true, data: { deleted: t.title } };
    }

    return { ok: false, error: `Unknown tool: ${toolName}` };
  },
};
