# @openclaw/todowrite

AI-managed task tracking for OpenClaw agents. **With spec-driven workflow support.**

## ✨ Highlights

### Spec-Driven Mode
Plan complex projects with structured requirements, design, and tasks before execution:

```
📋 Spec-Driven Plan

### Requirements
⬜ R1: Build authentication system
⬜ R2: Support OAuth2 login

### Design
⬜ D1: Use JWT tokens
⬜ D2: Store sessions in Redis

### Tasks
⬜ T1: Create login endpoint
⬜ T2: Implement token refresh
```

The AI agent creates a full spec, presents it for your approval, then executes step by step.

### 6 Actions

| Action | Description |
|--------|-------------|
| **create** | Initialize todo list |
| **add** | Append new tasks |
| **update** | Change status (pending → in_progress → completed) |
| **list** | Show all tasks |
| **reset** | Clear the list |
| **init_spec** | 🌟 Create spec-driven plan (requirements + design + tasks) |

### Other Features
- **Session-scoped**: each session has its own isolated todo list
- **File persistence**: saves to `~/.openclaw/todowrite/`
- **Real-time updates**: status changes visible in chat

## 📦 Installation

### Via Git (recommended)
```bash
git clone https://github.com/FQW700/openclaw-todowrite.git ~/.openclaw/extensions/todowrite
```

### Enable in openclaw.json
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

Then restart the gateway.

## 🚀 Usage

The AI agent automatically uses todowrite for tasks with 3+ steps. No manual configuration needed.

For complex features, the agent will use **init_spec** to create a structured plan:

1. **Requirements** — what to build and acceptance criteria
2. **Design** — how to build it
3. **Tasks** — specific steps with dependencies

You review and approve the plan before execution begins.

## 📄 License

MIT
