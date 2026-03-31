import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import fs from "fs/promises";
import path from "path";
import os from "os";

// ── Session-scoped todo store ──
interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  mode?: "simple" | "spec-driven";
  section?: "requirements" | "design" | "tasks";
}

// Per-session todo lists, keyed by sessionKey or sessionId
const sessionTodoStore = new Map<string, TodoItem[]>();

// Track the "current" session for tool execute calls (see comment below)
let activeSessionId: string | null = null;
let activeSessionTodos: TodoItem[] = [];
let activeSessionNextId = 1;

// Per-session next-id counters
const sessionNextId = new Map<string, number>();

// ── File persistence ──
const PERSIST_DIR = path.join(os.homedir(), ".openclaw", "todowrite");
let persistDirReady = false;

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function ensurePersistDir(): Promise<void> {
  if (persistDirReady) return;
  try {
    await fs.mkdir(PERSIST_DIR, { recursive: true });
    persistDirReady = true;
  } catch { /* ignore */ }
}

async function persistToFile(sessionId: string, todos: TodoItem[], nextId: number): Promise<void> {
  try {
    await ensurePersistDir();
    const filePath = path.join(PERSIST_DIR, `${sanitizeKey(sessionId)}.json`);
    await fs.writeFile(filePath, JSON.stringify({ todos, nextId }, null, 2), "utf-8");
  } catch { /* silent */ }
}

async function loadFromFile(sessionId: string): Promise<{ todos: TodoItem[]; nextId: number } | null> {
  try {
    const filePath = path.join(PERSIST_DIR, `${sanitizeKey(sessionId)}.json`);
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    if (Array.isArray(data.todos) && typeof data.nextId === "number") {
      return { todos: data.todos, nextId: data.nextId };
    }
  } catch { /* silent */ }
  return null;
}

/**
 * Get (or create) the todo list for a given session.
 * Node.js is single-threaded, so no race conditions.
 */
async function getSessionState(sessionId: string): Promise<{ todos: TodoItem[]; nextId: number }> {
  if (!sessionTodoStore.has(sessionId)) {
    // Try loading from file first
    const persisted = await loadFromFile(sessionId);
    if (persisted) {
      sessionTodoStore.set(sessionId, persisted.todos);
      sessionNextId.set(sessionId, persisted.nextId);
    } else {
      sessionTodoStore.set(sessionId, []);
      sessionNextId.set(sessionId, 1);
    }
  }
  return {
    todos: sessionTodoStore.get(sessionId)!,
    nextId: sessionNextId.get(sessionId)!,
  };
}

async function setSessionState(sessionId: string, todos: TodoItem[], nextId: number) {
  sessionTodoStore.set(sessionId, todos);
  sessionNextId.set(sessionId, nextId);
  await persistToFile(sessionId, todos, nextId);
}

function generateId(n: number): string {
  return `todo_${n}`;
}

function statusIcon(s: TodoItem["status"]) {
  switch (s) {
    case "completed": return "✅";
    case "in_progress": return "🔄";
    case "pending": return "⬜";
  }
}

function formatSection(items: TodoItem[]): string {
  return items.map(t => `${statusIcon(t.status)} [${t.id}] ${t.content}`).join("\n");
}

function formatTodos(todos: TodoItem[]): string {
  if (todos.length === 0) {
    return "📋 Todo list is empty. Use todowrite(action='add') to create tasks.";
  }

  const hasSpecMode = todos.some(t => t.mode === "spec-driven");

  if (hasSpecMode) {
    const sections = {
      requirements: todos.filter(t => t.section === "requirements"),
      design: todos.filter(t => t.section === "design"),
      tasks: todos.filter(t => t.section === "tasks"),
      other: todos.filter(t => !t.section),
    };

    let output = "📋 Spec-Driven Plan\n\n";

    if (sections.requirements.length) {
      output += "### Requirements\n" + formatSection(sections.requirements) + "\n\n";
    }
    if (sections.design.length) {
      output += "### Design\n" + formatSection(sections.design) + "\n\n";
    }
    if (sections.tasks.length) {
      output += "### Tasks\n" + formatSection(sections.tasks) + "\n\n";
    }
    if (sections.other.length) {
      output += "### Other\n" + formatSection(sections.other) + "\n";
    }

    return output.trim();
  } else {
    const completed = todos.filter(t => t.status === "completed").length;
    const lines = todos.map(t => `${statusIcon(t.status)} [${t.id}] ${t.content}`);
    return `📋 Todo List (${completed}/${todos.length} completed)\n${lines.join("\n")}`;
  }
}

// ── Prompt injection ──
const TODO_INSTRUCTIONS = `<todowrite-instructions>
You have a "todowrite" tool for task tracking. USE IT for any task with 3+ steps.

Workflow:
1. At the START of a multi-step task → todowrite(action='create', todos=[...]) with all tasks as "pending"
2. When STARTING a task → todowrite(action='update', todos=[{id:'todo_1', status:'in_progress'}])
3. When DONE with a task → todowrite(action='update', todos=[{id:'todo_1', status:'completed'}])
4. When discovering new tasks → todowrite(action='add', todos=[...])

Rules:
- Mark only ONE task as in_progress at a time
- Update status BEFORE and AFTER each step
- The user sees your todo updates in real-time — keep them accurate
- Don't use for trivial 1-2 step tasks

Spec-Driven Mode (for complex tasks with 5+ steps or new feature development):
- Before executing, create a plan with: (1) Requirements — what to build and acceptance criteria, (2) Design — how to build it, (3) Tasks — specific steps with dependencies
- Use \`todowrite(action='init_spec', requirements=[...], design=[...], tasks=[...])\` to quickly create a spec-driven plan
- Present the plan to the user for confirmation BEFORE starting implementation
- Only begin execution after user approves the plan
- If requirements change mid-task, update the plan first then continue
</todowrite-instructions>`;

// ── Plugin ──
export default definePluginEntry({
  id: "todowrite",
  name: "TodoWrite",
  description: "AI-managed task tracking list for complex multi-step tasks",

  register(api) {
    // ── Session tracking via before_prompt_build hook ──
    // This hook fires before each LLM call and gives us the session context.
    // We store the active session ID so the tool execute function can use it.
    // Node.js is single-threaded → no concurrency issues.
    api.on("before_prompt_build", async (event: unknown, ctx?: { sessionKey?: string; sessionId?: string }) => {
      // Session info is in the SECOND argument (ctx), not in the event
      const sid = ctx?.sessionKey || ctx?.sessionId;
      if (sid) {
        activeSessionId = sid;
        const state = await getSessionState(sid);
        activeSessionTodos = state.todos;
        activeSessionNextId = state.nextId;
      }

      // Inject TodoWrite instructions into prompt
      const eventObj = (event ?? {}) as { messages?: unknown[] };
      const hasMessages = Array.isArray(eventObj.messages) && eventObj.messages.length > 0;
      return {
        prependContext: hasMessages ? TODO_INSTRUCTIONS : undefined,
      };
    });

    // Also track session on other lifecycle hooks
    api.on("session_start", async (_event: unknown, ctx?: { sessionKey?: string; sessionId?: string }) => {
      if (ctx) {
        const sid = ctx.sessionKey || ctx.sessionId;
        if (sid) {
          activeSessionId = sid;
          const state = await getSessionState(sid);
          activeSessionTodos = state.todos;
          activeSessionNextId = state.nextId;
        }
      }
    });

    // ── Register the tool ──
    api.registerTool(
      {
        name: "todowrite",
        description:
          "Create and manage a structured task list for tracking progress on complex multi-step tasks. " +
          "Use this when a task has 3+ steps, to track what's done, in progress, and remaining. " +
          "Actions: create (initialize list), add (append tasks), update (change status/id/content), list (show all), reset (clear list), init_spec (quickly create spec-driven plan). " +
          "Status values: pending, in_progress, completed.",
        parameters: Type.Object({
          action: Type.String({
            description: "Action: create, add, update, list, reset, init_spec",
          }),
          todos: Type.Optional(
            Type.Array(
              Type.Object({
                id: Type.Optional(Type.String({ description: "Todo ID (required for update)" })),
                content: Type.Optional(Type.String({ description: "Task description" })),
                status: Type.Optional(
                  Type.String({ description: "Status: pending, in_progress, completed" })
                ),
              }),
              { description: "Todo items (required for create/add/update)" }
            ),
          ),
          requirements: Type.Optional(
            Type.Array(Type.String(), { description: "Requirements list for init_spec" })
          ),
          design: Type.Optional(
            Type.Array(Type.String(), { description: "Design list for init_spec" })
          ),
          tasks: Type.Optional(
            Type.Array(Type.String(), { description: "Tasks list for init_spec" })
          ),
        }),

        async execute(_id, params) {
          const sid = activeSessionId;
          if (!sid) {
            return { content: [{ type: "text" as const, text: "❌ No active session context. Cannot manage todos." }] };
          }

          const action = (params.action as string)?.toLowerCase();

          switch (action) {
            case "create": {
              if (!params.todos || !Array.isArray(params.todos) || params.todos.length === 0) {
                return { content: [{ type: "text" as const, text: "❌ create requires a non-empty todos array with content." }] };
              }
              const todos = (params.todos as any[]).map((t, i) => ({
                id: t.id || generateId(i + 1),
                content: t.content || `Task ${i + 1}`,
                status: (t.status as TodoItem["status"]) || "pending",
              }));
              const ni = todos.length + 1;
              await setSessionState(sid, todos, ni);
              // Sync active state
              activeSessionTodos = todos;
              activeSessionNextId = ni;
              return { content: [{ type: "text" as const, text: formatTodos(todos) }] };
            }

            case "add": {
              if (!params.todos || !Array.isArray(params.todos) || params.todos.length === 0) {
                return { content: [{ type: "text" as const, text: "❌ add requires a non-empty todos array with content." }] };
              }
              const { todos, nextId: ni } = await getSessionState(sid);
              let curId = ni;
              for (const t of params.todos as any[]) {
                todos.push({
                  id: t.id || generateId(curId++),
                  content: t.content || "Untitled task",
                  status: (t.status as TodoItem["status"]) || "pending",
                });
              }
              await setSessionState(sid, todos, curId);
              activeSessionTodos = todos;
              activeSessionNextId = curId;
              return { content: [{ type: "text" as const, text: formatTodos(todos) }] };
            }

            case "update": {
              if (!params.todos || !Array.isArray(params.todos) || params.todos.length === 0) {
                return { content: [{ type: "text" as const, text: "❌ update requires todos array with id and fields to update." }] };
              }
              const { todos, nextId: ni } = await getSessionState(sid);
              for (const t of params.todos as any[]) {
                if (!t.id) {
                  return { content: [{ type: "text" as const, text: "❌ update requires each item to have an id." }] };
                }
                const idx = todos.findIndex(g => g.id === t.id);
                if (idx === -1) {
                  return { content: [{ type: "text" as const, text: `❌ Todo item '${t.id}' not found.` }] };
                }
                if (t.content !== undefined) todos[idx].content = t.content;
                if (t.status !== undefined) todos[idx].status = t.status as TodoItem["status"];
              }
              await setSessionState(sid, todos, ni);
              activeSessionTodos = todos;
              return { content: [{ type: "text" as const, text: formatTodos(todos) }] };
            }

            case "list": {
              const { todos } = await getSessionState(sid);
              return { content: [{ type: "text" as const, text: formatTodos(todos) }] };
            }

            case "reset": {
              await setSessionState(sid, [], 1);
              activeSessionTodos = [];
              activeSessionNextId = 1;
              return { content: [{ type: "text" as const, text: "🗑️ Todo list cleared." }] };
            }

            case "init_spec": {
              const reqs = (params.requirements as string[]) || [];
              const designs = (params.design as string[]) || [];
              const tasks = (params.tasks as string[]) || [];

              if (reqs.length === 0 && designs.length === 0 && tasks.length === 0) {
                return { 
                  content: [{ 
                    type: "text" as const, 
                    text: "❌ init_spec requires at least one of requirements, design, or tasks array." 
                  }] 
                };
              }

              const todos: TodoItem[] = [];
              let idCounter = 1;

              reqs.forEach(content => {
                todos.push({
                  id: generateId(idCounter++),
                  content: `Requirements: ${content}`,
                  status: "pending",
                  mode: "spec-driven",
                  section: "requirements"
                });
              });

              designs.forEach(content => {
                todos.push({
                  id: generateId(idCounter++),
                  content: `Design: ${content}`,
                  status: "pending",
                  mode: "spec-driven",
                  section: "design"
                });
              });

              tasks.forEach(content => {
                todos.push({
                  id: generateId(idCounter++),
                  content,
                  status: "pending",
                  mode: "spec-driven",
                  section: "tasks"
                });
              });

              await setSessionState(sid, todos, idCounter);
              activeSessionTodos = todos;
              activeSessionNextId = idCounter;

              return {
                content: [{
                  type: "text" as const,
                  text: formatTodos(todos) + "\n\n💡 计划创建完成！请用户确认后，可以使用 `/exec` 切换到执行模式。"
                }]
              };
            }

            default:
              return {
                content: [{
                  type: "text" as const,
                  text: `❌ Unknown action '${action}'. Valid actions: create, add, update, list, reset, init_spec`,
                }],
              };
          }
        },
      },
      { optional: false },
    );

    api.logger.info("todowrite: registered (session-scoped, prompt-injected)");
  },
});
