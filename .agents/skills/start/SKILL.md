---
name: start
description: Get started with Mug — guided orientation for new workspaces, progress checklist for existing ones. Recommends what to build next.
---

# Start

Guided onboarding for new workspaces and "what's next?" for existing ones. Goal: help every workspace build all 5 primary components.

## Step 1 — Check workspace

If there's no `mug.json` in the current directory, the user isn't in a workspace yet:

1. Ask if they want to create a new workspace or clone an existing one
2. New → run `mug init <name>` (ask for a workspace name)
3. Clone → run `mug clone`
4. After init/clone completes, continue to Step 2

## Step 2 — Detect what's built

Scan the workspace to see which of the 5 primary components exist:

- **Connectors**: any `.ts` files in `connectors/`
- **Workflows**: any `.ts` files in `workflows/`
- **AI Agents**: any folders in `agents/` containing `agent.json`
- **Surfaces**: any `.json` files in `surfaces/`
- **Slack App**: `slack.json` exists and has `"enabled": true`

## Step 3 — Route based on state

### New workspace (nothing built)

Print the full orientation, then recommend a starting point:

---

**What Mug is**

Mug is an AI automation platform for building deployed agents, real code workflows, and headless web surfaces for everyday business — integrated with any API, and accessed via email, SMS, and Slack. Everything is built locally using Claude Code, Codex, or Cursor.

**What you can build**

There are 5 primary components in a Mug workspace:

1. **Connectors** — sync data from any external API into local SQLite. OAuth, pagination, rate limits, and incremental sync are handled for you. Use `/connector` to get started.
2. **Workflows** — scheduled or triggered automation. Query data, call AI, send notifications, approve/reject, call external APIs. Use `/workflow` to get started.
3. **AI Agents** — autonomous multi-turn agents with tools, memory, cost controls, and structured output. Reason over synced business data. Use `/agents` to get started.
4. **Surfaces** — web forms, portals, and dashboards on branded subdomains. Collect data, display dashboards, handle approvals. Use `/form` or `/portal` to get started.
5. **Slack App** — deploy a fully bespoke Slack app with slash commands, interactive buttons, Home Tab, and AI agent DMs. Use `/slack` to get started.

**Where to start**

Most workspaces start with a **connector** — pull in real data first, then everything else has something to work with. What system does your client use? (QuickBooks, HubSpot, ServiceTitan, Airtable, etc.)

→ Hand off to `/connector` with the user's chosen API.

---

### Existing workspace (has at least one component)

Print a progress checklist, then recommend the next component:

---

**Workspace progress**

Show each component with ✓ or ○, listing what's built:

```
✓ Connectors — quickbooks (3 tables)
✓ Workflows — weekly-report, invoice-reminder
○ AI Agents — none yet
○ Surfaces — none yet
○ Slack App — not enabled
```

**Recommended next**

Follow the dependency chain to pick the best next component:

1. **Connector** (if none) — "Start by connecting a data source. What API does your client use?" → `/connector`
2. **Workflow** (if no workflows, but has connectors) — "You have data syncing. Build a workflow to do something with it — a scheduled report, a triggered alert, an approval chain." → `/workflow`
3. **AI Agent** (if no agents, but has data) — "Build an AI agent that can reason over your synced data — classify, summarize, draft responses, make decisions." → `/agents`
4. **Surface** (if no surfaces, but has data or workflows) — "Give people a way to interact — an approval form, a status dashboard, a data portal." → `/form` or `/portal`
5. **Slack App** (if not enabled, but has agents or workflows) — "Connect your agents and workflows to Slack — slash commands, interactive buttons, AI chat." → `/slack`

If all 5 are built: "This workspace has all 5 primary components. You can add more of any type, or run `mug deploy` to ship it."

Present the recommendation but let the user choose any component. Hand off to the relevant skill.

---

## Available skills for hand-off

- `/connector` — build a connector for an external API
- `/workflow` — create a workflow
- `/agents` — create an AI agent
- `/form` — create a form surface
- `/portal` — create a portal surface
- `/slack` — set up a Slack app
- `/notify` — add email/SMS notifications to a workflow
- `/ai` — add AI to a workflow
- `/demo` — share surfaces with stakeholders
