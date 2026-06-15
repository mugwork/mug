---
name: slack
description: Build Slack integrations — configure slack.json, send Block Kit messages, slash commands, interactive buttons, Home Tab, shortcuts, and two-way workflows.
argument-hint: "<slack feature or description>"
---

# Slack Integration

Build Slack-powered surfaces for workspaces. Mug creates per-client Slack apps via manifest API — each client gets their own branded app, one-click install, full Block Kit control.

For full API reference, see `.mug/docs/slack.md`, `.mug/docs/api.md` (Slack section), and `.mug/docs/notifications.md`.

## slack.json — App Configuration

Every workspace has a `slack.json` at the root. Created by `mug init` with `{"enabled": false}`.

### Minimal — enable Slack

```json
{
  "enabled": true,
  "name": "Acme Dispatch",
  "description": "Job dispatch and approval"
}
```

### Full schema

```json
{
  "enabled": true,
  "name": "Acme Dispatch",
  "description": "Job dispatch and approval",
  "color": "#1a1a2e",
  "botName": "acme-ops",
  "homeTab": {
    "enabled": true,
    "sections": [
      {
        "type": "text",
        "title": "Operations Dashboard",
        "text": "Real-time overview of active jobs and crew status."
      },
      {
        "type": "query",
        "title": "Active Jobs",
        "database": "jobs",
        "query": "SELECT title, status, assignee FROM jobs WHERE status = 'active' ORDER BY created_at DESC",
        "columns": ["title", "status", "assignee"]
      },
      {
        "type": "actions",
        "buttons": [
          { "text": "Run Daily Report", "workflow": "daily-report", "style": "primary" },
          { "text": "Sync All Sources", "workflow": "run-sync" }
        ]
      },
      { "type": "divider" },
      {
        "type": "query",
        "title": "Recent Alerts",
        "database": "ops",
        "query": "SELECT message, created_at FROM alerts ORDER BY created_at DESC LIMIT 5",
        "columns": ["message", "created_at"],
        "emptyMessage": "No recent alerts."
      }
    ]
  },
  "messagesTab": true,
  "shortcuts": [
    {
      "name": "Create Dispatch",
      "callbackId": "create_dispatch",
      "description": "Create a new dispatch job",
      "type": "global",
      "workflow": "create-dispatch"
    }
  ],
  "unfurlDomains": ["acme.mug.work"],
  "scopes": []
}
```

### Field reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Slack app for this workspace |
| `name` | string | workspace name | App display name in Slack (max 35 chars) |
| `description` | string | — | App description (max 140 chars) |
| `color` | string | — | App background color (hex, e.g. `"#1a1a2e"`) |
| `botName` | string | same as name | Bot display name (max 80 chars) |
| `homeTab` | object | — | Home Tab configuration (see below) |
| `messagesTab` | boolean | `false` | Enable DM tab — users can message the bot directly. Auto-enabled when any agent has `chat: true` in agent.json |
| `defaultAgent` | string | — | Agent name for DMs when no agent is specified (must match an `agents/<name>/` folder with `chat: true`) |
| `suggestedPrompts` | array | auto-generated | Prompts shown when user opens a DM. Each: `{ title, agent }` or `{ title, message }`. Max 4. |
| `appIcon` | string | — | Path to app icon image (512-2000px square) for reference. Must be uploaded manually via Slack UI — the manifest API doesn't support icons. |
| `shortcuts` | array | — | Global and message shortcuts (see below) |
| `unfurlDomains` | string[] | — | Domains to unfurl with rich previews (max 5) |
| `scopes` | string[] | — | Additional OAuth scopes (most are auto-inferred) |
| `commands` | object | — | Explicit slash commands not tied to workflow triggers |
| `events` | string[] | — | Additional event subscriptions |

### Scope auto-inference

Most scopes are inferred automatically:
- **Always added:** `chat:write`, `channels:join`, `channels:read`, `groups:read`, `users:read`, `users:read.email`, `im:write`, `mpim:read`, `mpim:write`, `reactions:write`, `files:write`
- `commands` — when slash commands or shortcuts exist
- `im:history` — when Messages Tab is enabled
- `links:read`, `links:write` — when unfurl domains are configured
- `assistant:write`, `app_mentions:read` — when chat agents detected

Add explicit `scopes` only for capabilities not covered by auto-inference.

### Scope change warnings

When a deploy adds new OAuth scopes, `mug deploy` warns:
```
⚠ New OAuth scopes: users:read, users:read.email — workspace admin may need to re-authorize
```

## Home Tab

The Home Tab is a per-user dashboard inside the Slack app. Configured in `slack.json` as sections, rendered automatically when a user opens the app.

### Section types

**query** — run SQL, render as a table:
```json
{
  "type": "query",
  "title": "Active Projects",
  "database": "projects",
  "query": "SELECT name, status, manager FROM projects WHERE status = 'active'",
  "columns": ["name", "status", "manager"],
  "emptyMessage": "No active projects."
}
```

**actions** — buttons that trigger workflows:
```json
{
  "type": "actions",
  "buttons": [
    { "text": "Run Daily Report", "workflow": "daily-report", "style": "primary" },
    { "text": "Sync Data", "workflow": "run-sync" }
  ]
}
```
Button styles: `"primary"` (green), `"danger"` (red), or omit for default gray.

**text** — headers and markdown:
```json
{
  "type": "text",
  "title": "Welcome",
  "text": "Operations dashboard for Acme. Updated in real-time."
}
```

**divider** — visual separator:
```json
{ "type": "divider" }
```

### Limits

- Max 100 blocks per Home Tab (Slack limit). Sections truncate with "showing X of Y" if over.
- Query results capped at 15 rows per section.
- Home Tab refreshes each time a user opens the app.

## Shortcuts

Shortcuts appear in Slack's lightning bolt menu (global) or message context menu (message).

```json
{
  "shortcuts": [
    {
      "name": "Run Workflow",
      "callbackId": "run_workflow",
      "description": "Trigger a Mug workflow",
      "type": "global",
      "workflow": "run-workflow"
    },
    {
      "name": "Summarize Thread",
      "callbackId": "summarize",
      "description": "AI summary of this thread",
      "type": "message",
      "workflow": "summarize-thread"
    }
  ]
}
```

The `workflow` field maps the shortcut directly to a workflow. The workflow receives:
- `ctx.params.callbackId` — the shortcut's callback ID
- `ctx.params.triggerId` — for opening modals
- `ctx.params.userId`, `ctx.params.userName`
- For message shortcuts: `ctx.params.messageTs`, `ctx.params.channelId`, `ctx.params.messageText`

## Workflow Triggers

Slack triggers are defined in workflow `.ts` files, not in `slack.json`:

```typescript
import { workflow } from "@mugwork/mug";

workflow("handle-dispatch", async (ctx) => {
  // ctx.params.command, ctx.params.text, ctx.params.triggerId
  await ctx.slack.openModal({ ... });
}, {
  trigger: { type: "slack_command", command: "/dispatch", description: "Create a dispatch" },
});

workflow("classify-message", async (ctx) => {
  // ctx.params.text, ctx.params.userId, ctx.params.channelId
}, {
  trigger: { type: "slack_event", event: "message" },
});
```

Triggers merge into the manifest automatically at deploy time.

## Sending Messages

`to` accepts a channel name (`#ops-alerts` or `ops-alerts`) or a channel ID (`C01234ABCDE`). Channel names are resolved automatically. The bot auto-joins public channels on first message — private channels need the bot added manually via the channel's Integrations tab.

```typescript
// Plain text
await ctx.notify.slack({
  to: "#ops-alerts",
  message: "New job assigned",
});

// Block Kit — raw blocks, no Mug abstraction
await ctx.notify.slack({
  to: "C01234ABCDE",
  message: "Approval needed",
  blocks: [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*New job:* ${job.title}\n*Customer:* ${job.customer}` },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve" },
          action_id: "mug:handle-approval:approve",
          value: job.id.toString(),
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject" },
          action_id: "mug:handle-approval:reject",
          value: job.id.toString(),
          style: "danger",
        },
      ],
    },
  ],
});

// Threading
await ctx.notify.slack({
  to: channelId,
  message: "Update on the job",
  thread_ts: originalMessageTs,
});
```

## Action ID Convention

Button `action_id` format: `mug:<workflow>:<custom>`

- `mug:handle-approval:approve` → routes to `handle-approval` workflow
- Without `mug:` prefix → routes to the default inbound Slack handler

The workflow receives `ctx.params.actionId` (the custom part) and `ctx.params.actionValue`.

## Message Updates

```typescript
await ctx.slack.updateMessage({
  channel: ctx.params.channelId,
  ts: ctx.params.messageTs,
  text: "Approved",
  blocks: [
    { type: "section", text: { type: "mrkdwn", text: `*Approved* by <@${ctx.params.userId}>` } },
  ],
});
```

## Slash Commands

```typescript
workflow("handle-dispatch", async (ctx) => {
  await ctx.slack.openModal({
    triggerId: ctx.params.triggerId,
    view: {
      type: "modal",
      title: { type: "plain_text", text: "Create Dispatch" },
      submit: { type: "plain_text", text: "Create" },
      blocks: [
        {
          type: "input",
          element: { type: "plain_text_input", action_id: "title" },
          label: { type: "plain_text", text: "Job Title" },
        },
      ],
    },
  });
}, {
  trigger: { type: "slack_command", command: "/dispatch", description: "Create a dispatch" },
});
```

## Human-in-the-Loop

```typescript
const callbackUrl = await ctx.waitForUrl("approval");

await ctx.notify.slack({
  to: "#approvals",
  message: "Approve this job?",
  blocks: [
    { type: "section", text: { type: "mrkdwn", text: `*${job.title}* — $${job.amount}` } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve" },
          url: `${callbackUrl}?action=approved`,
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject" },
          url: `${callbackUrl}?action=rejected`,
          style: "danger",
        },
      ],
    },
  ],
});

const result = await ctx.waitFor("approval", { timeout: "24h" });
if (result.timedOut) { /* escalate */ }
// result.payload.action === "approved" or "rejected"
```

## Slack Data

After Slack app install, `slack_users` and `slack_channels` tables auto-sync every 6 hours.

```sql
SELECT t.name, t.specialty, s.display_name, s.email
FROM technicians t
JOIN slack_users s ON s.email = t.email;
```

## App Setup

Run `mug slack setup` to create the Slack app and store credentials. Interactive — handles two paths:

**Path A — Developer is admin in target Slack workspace:**
1. CLI opens Slack's config token generation page
2. Developer generates token for the client's workspace, pastes it back
3. CLI calls Slack's Manifest API to create the app automatically
4. All credentials (app ID, client ID, client secret, signing secret, config token) stored as workspace secrets
5. CLI prints the install URL — share with client to authorize

**Path B — Developer is NOT admin:**
1. CLI generates a manifest URL and clear instructions to send to the client admin
2. Client admin creates the app, generates a config token, sends 6 values back
3. Developer runs `mug slack setup` again to enter the credentials incrementally

Both paths end the same: config token stored, future `mug deploy` auto-updates the manifest.

`mug slack setup` detects existing state — run it multiple times as credentials come in. It only asks for what's missing.

### After setup

1. **Deploy**: `mug deploy` pushes the manifest and credentials
2. **Install**: someone with workspace admin access visits `https://api.mug.work/slack/install/<workspace>` — OAuth stores the bot token automatically
3. **Future deploys**: manifest auto-updates via config token, no manual steps

### Secrets (managed by `mug slack setup`)

| Secret | Source |
|--------|--------|
| `SLACK_CONFIG_TOKEN` | Generated by workspace admin at api.slack.com |
| `SLACK_CONFIG_REFRESH_TOKEN` | Generated alongside config token |
| `SLACK_APP_ID` | Auto-stored on app creation (or from Basic Information page) |
| `SLACK_CLIENT_ID` | Auto-stored on app creation (or from Basic Information page) |
| `SLACK_CLIENT_SECRET` | Auto-stored on app creation (or from Basic Information page) |
| `SLACK_SIGNING_SECRET` | Auto-stored on app creation (or from Basic Information page) |
| `SLACK_BOT_TOKEN` | Auto-stored after OAuth install callback |

## AI Agent DMs (Agents & AI Apps)

Mug uses Slack's "Agents & AI Apps" feature for agent conversations. When any agent has `chat: true` in `agent.json`, deploy auto-enables the Agents & AI mode with proper scopes and events.

### Setup

1. Add `"chat": true` to `agents/<name>/agent.json`
2. Set `"defaultAgent"` in `slack.json` to the agent name
3. `mug deploy` — auto-adds `assistant:write`, `im:history`, `app_mentions:read` scopes
4. Enable "Agents & AI Apps" in Slack UI: `https://api.slack.com/apps/<app_id>/app-assistant`
5. Set suggested prompts to "Dynamic" in the same UI page

### Multi-agent routing

Multiple agents can share one Slack app. Users are routed by:
- **Suggested prompts**: clicking a prompt pins the thread to that agent
- **@mentions**: `@BotName agent-name query` routes to the named agent
- **Thread pinning**: once a thread is assigned to an agent, all messages in that thread go to the same agent

Configure per-agent names visible in Slack with `"slackName"` in `agent.json`:

```json
{
  "model": "openai/gpt-4.1-nano",
  "tools": ["query"],
  "chat": true,
  "slackName": "ops-bot"
}
```

### Suggested prompts

Auto-generated from chat agents, or configure explicitly in `slack.json`:

```json
{
  "suggestedPrompts": [
    { "title": "Ask Ops Bot", "agent": "ops-bot" },
    { "title": "Check Schedule", "message": "What's on the schedule today?" }
  ]
}
```

- `agent` prompts include an `agent:<name>` prefix to pin the thread
- `message` prompts send the text directly to the default agent
- Max 4 prompts (Slack limit)

### App icon

Slack's manifest API doesn't support setting app icons programmatically. Upload manually at `https://api.slack.com/apps/<app_id>/general` (512px+ square PNG). `mug deploy` prints this link on first app creation.

## Block Kit Reference

Agents already know Block Kit. Use Slack's Block Kit Builder for visual design: https://app.slack.com/block-kit-builder

For Slack API docs: https://docs.slack.dev/apis/web-api.md
