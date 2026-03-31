# @openclaw/todowrite

AI-managed task tracking for OpenClaw agents.

## Features

- **5 actions**: create, add, update, list, reset
- **Spec-driven mode**: init_spec (requirements + design + tasks)
- **Session-scoped**: each session has its own todo list
- **File persistence**: saves to `~/.openclaw/todowrite/`
- **Real-time updates**: status changes visible in chat

## Installation

### Via npm

```bash
npm install -g @openclaw/todowrite
```

### Via OpenClaw

```bash
openclaw plugins install @openclaw/todowrite
```

### Manual

```bash
git clone https://github.com/OpulentiaAI/todowrite.git ~/.openclaw/extensions/todowrite
```

Then enable in `openclaw.json`:

```json
{
  "plugins": {
    "allow": ["todowrite"],
    "entries": {
      "todowrite": { "enabled": true }
    }
  }
}
```

## Usage

The AI agent automatically uses todowrite for tasks with 3+ steps. No manual configuration needed.

### Actions

| Action | Description |
|--------|-------------|
| create | Initialize a new todo list |
| add | Append new tasks |
| update | Change task status (pending → in_progress → completed) |
| list | Show all tasks with status |
| reset | Clear the list |
| init_spec | Create spec-driven plan (requirements + design + tasks) |

### Example

```
Agent: I'll track this with todowrite.
📋 Todo List (0/5 completed)
⬜ [t1] Create plugin skeleton
⬜ [t2] Implement feature A
🔄 [t3] Write tests
✅ [t4] Deploy to staging
⬜ [t5] Monitor production
```

## License

MIT
