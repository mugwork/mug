# Slack — Full API Reference

For a guided walkthrough, use the `/slack` skill.

## slack.json Schema

Every workspace has a `slack.json` at the root. Created by `mug init` with `{"enabled": false}`.

```typescript
interface SlackJsonConfig {
  enabled: boolean;          // Enable Slack app for this workspace
  name?: string;             // App display name (max 35 chars, default: workspace name)
  description?: string;      // App description (max 140 chars)
  color?: string;            // App background color (hex, e.g. "#1a1a2e")
  botName?: string;          // Bot display name (max 80 chars, default: same as name)
  homeTab?: {
    enabled: boolean;
    sections?: HomeTabSection[];
  };
  messagesTab?: boolean;     // Enable DM tab (users can message the bot)
  defaultAgent?: string;     // Agent name for DMs when no agent specified (must have chat: true)
  suggestedPrompts?: (       // Prompts shown when user opens a DM (max 4)
    | { title: string; agent: string }   // Pin thread to a specific agent
    | { title: string; message: string } // Send text to default agent
  )[];
  appIcon?: string;          // Reference path for app icon (must be uploaded manually via Slack UI)
  shortcuts?: ShortcutConfig[];
  unfurlDomains?: string[];  // Domains for rich link previews (max 5)
  scopes?: string[];         // Additional OAuth scopes (most auto-inferred)
  commands?: Record<string, { description: string; usage_hint?: string }>;
  events?: string[];         // Additional event subscriptions
}
```

## Home Tab

Data-driven dashboard inside the Slack app. Rendered per-user when they open the App Home.

### HomeTabSection types

```typescript
type HomeTabSection =
  | { type: "query"; title?: string; database: string; query: string; columns?: string[]; emptyMessage?: string }
  | { type: "actions"; title?: string; buttons: { text: string; workflow: string; style?: "primary" | "danger" }[] }
  | { type: "text"; title?: string; text?: string }
  | { type: "divider" };
```

### query

Runs SQL against a workspace database, renders results as a table.

```json
{
  "type": "query",
  "title": "Active Projects",
  "database": "projects",
  "query": "SELECT name, status, manager FROM projects WHERE status = 'active' ORDER BY name",
  "columns": ["name", "status", "manager"],
  "emptyMessage": "No active projects."
}
```

- `columns` defaults to first 4 columns of the result if omitted
- Results capped at 15 rows with "Showing 15 of N rows" overflow
- `emptyMessage` shown when query returns zero rows (default: "No data")

### actions

Renders buttons that trigger workflows when clicked.

```json
{
  "type": "actions",
  "title": "Quick Actions",
  "buttons": [
    { "text": "Run Daily Report", "workflow": "daily-report", "style": "primary" },
    { "text": "Sync All Sources", "workflow": "run-sync" },
    { "text": "Clear Alerts", "workflow": "clear-alerts", "style": "danger" }
  ]
}
```

Buttons use `action_id: "mug:<workflow>:run"` — routed by the existing Slack interaction handler.

### text

Renders a header and/or markdown text.

```json
{ "type": "text", "title": "Operations Dashboard", "text": "Updated every time you open this tab." }
```

- `title` renders as a Block Kit `header` block
- `text` renders as a `section` block with `mrkdwn`
- Both are optional (but at least one should be present)

### divider

Visual separator between sections.

```json
{ "type": "divider" }
```

### Limits

- Max 100 blocks per Home Tab (Slack platform limit)
- Sections render in order until the 100-block limit is reached, then truncate
- Home Tab refreshes on every `app_home_opened` event (each time a user opens the app)

## Shortcuts

Appear in Slack's lightning bolt menu (global) or message context menu (message).

```typescript
interface ShortcutConfig {
  name: string;           // Shortcut display name
  callbackId: string;     // Unique identifier (max 255 chars)
  description: string;    // Description (max 150 chars)
  type: "global" | "message";
  workflow?: string;      // Direct workflow mapping (optional — can also use workflow triggers)
}
```

### Example

```json
{
  "shortcuts": [
    {
      "name": "Create Dispatch",
      "callbackId": "create_dispatch",
      "description": "Create a new dispatch job",
      "type": "global",
      "workflow": "create-dispatch"
    },
    {
      "name": "Summarize Thread",
      "callbackId": "summarize_thread",
      "description": "AI summary of this conversation",
      "type": "message",
      "workflow": "summarize-thread"
    }
  ]
}
```

### Workflow params

Global shortcut workflow receives:
- `ctx.params.callbackId` — the shortcut's callback ID
- `ctx.params.triggerId` — for opening modals via `ctx.slack.openModal()`
- `ctx.params.userId`, `ctx.params.userName`

Message shortcut workflow additionally receives:
- `ctx.params.messageTs` — timestamp of the message
- `ctx.params.channelId` — channel where the message is
- `ctx.params.messageText` — text content of the message

## Unfurl Domains

When a URL matching a configured domain is posted in Slack, the app renders a rich preview showing the surface title, type, and an "Open" button.

```json
{
  "unfurlDomains": ["acme.mug.work"]
}
```

Max 5 domains. Auto-adds `links:read` and `links:write` scopes and `link_shared` event.

## Messages Tab

```json
{
  "messagesTab": true
}
```

Enables the DM tab in the Slack app. Users can message the bot directly. DMs arrive as `message.im` events and route to the inbound Slack workflow handler. Auto-adds `im:history` scope.

## AI Agent DMs (Agents & AI Apps)

Mug uses Slack's "Agents & AI Apps" feature for agent conversations — threaded DMs with status indicators and suggested prompts.

### How it works

1. Any agent with `"chat": true` in `agent.json` is a chat agent
2. On deploy, Mug detects chat agents and auto-enables Agents & AI mode in the manifest
3. Auto-adds scopes: `assistant:write`, `im:history`, `app_mentions:read`
4. Auto-adds events: `assistant_thread_started`, `assistant_thread_context_changed`, `message.im`, `app_mention`

### Configuration

```json
{
  "enabled": true,
  "name": "Acme Ops",
  "defaultAgent": "ops-bot",
  "suggestedPrompts": [
    { "title": "Ask Ops Bot", "agent": "ops-bot" },
    { "title": "Check Schedule", "message": "What's on the schedule today?" }
  ],
  "appIcon": "assets/slack-icon.png"
}
```

### agent.json fields for Slack

```json
{
  "model": "openai/gpt-4.1-nano",
  "tools": ["query"],
  "chat": true,
  "slackName": "ops-bot"
}
```

- `chat: true` — enables the agent for Slack DMs
- `slackName` — optional display name for @mention routing (e.g., `@BotName ops-bot what's the schedule?`)

### Multi-agent routing

Multiple chat agents can share one Slack app. Routing:
- **Suggested prompts with `agent`**: clicking pins the thread to that agent
- **@mentions**: `@BotName <slackName> <query>` routes to the named agent
- **Thread pinning**: once assigned, all messages in a thread go to the same agent
- **Default**: messages with no agent prefix go to `defaultAgent`

If `suggestedPrompts` is not configured, Mug auto-generates prompts from all chat agents.

### App icon

Slack's manifest API doesn't support setting icons programmatically. Upload manually at `https://api.slack.com/apps/<app_id>/general` (512px+ square PNG). `mug deploy` prints this link on first app creation. The `appIcon` field in `slack.json` is for reference only.

### Manual setup steps

After first deploy with chat agents, three steps require manual action in Slack UI:

1. **Enable Agents & AI Apps**: `https://api.slack.com/apps/<app_id>/app-assistant`
2. **Set suggested prompts to "Dynamic"** in the same page
3. **Verify event URL**: `https://api.slack.com/apps/<app_id>/event-subscriptions`

`mug deploy` prints these links when relevant.

## App Setup

`mug slack setup` supports both interactive (terminal) and flag-driven (agent) modes. All flags work without readline prompts.

### Check state

```bash
mug slack setup --json
```

Returns: `appId`, `hasCredentials`, `hasConfigToken`, `configTokenValid`, `hasBotToken`, `hasAgents`, `installUrl`, `configTokenUrl`, plus app-specific URLs when an app exists.

### New app — developer is admin

1. `mug slack setup --json` — check current state
2. Open `https://api.slack.com/apps` for the user — they generate a config token
3. `mug slack setup --config-token "xoxe.xoxp-..." --refresh-token "xoxe-..."` — save tokens
4. `mug slack setup --create-app` — create Slack app via Manifest API
5. `mug slack setup --install-url --open` — open install URL in browser

### New app — developer is NOT admin

1. `mug slack setup --admin-instructions` — outputs copy-pasteable plain text with numbered steps and manifest JSON. Developer sends this to their Slack admin.
2. Admin follows instructions, sends back 6 values.
3. `mug slack setup --app-id "..." --client-id "..." --client-secret "..." --signing-secret "..."` — save credentials
4. `mug slack setup --config-token "xoxe.xoxp-..." --refresh-token "xoxe-..."` — save tokens
5. `mug slack setup --install-url --open` — install the app

### Refresh expired config token

Config tokens have a 12-hour expiry. `mug deploy` rotates them automatically. If too much time passes between deploys, both tokens expire:

- `mug deploy` fails with: `Slack deploy failed: {"status":"update_failed","error":"invalid_auth"}`
- Followed by: `Config token expired — run mug slack setup to refresh.`

Fix: open `https://api.slack.com/apps` → generate fresh tokens → `mug slack setup --config-token "..." --refresh-token "..."`

### Reinstall (scope changes)

```bash
mug slack setup --install-url --open
```

### Other flags

```bash
mug slack setup --manifest           # output generated manifest JSON
mug slack setup --install-url        # print install URL
mug slack setup --install-url --open # print and open in browser
```

### After setup

1. `mug deploy` — pushes the manifest and syncs credentials to production
2. Share install URL (`https://api.mug.work/slack/install/<workspace>`) with a workspace admin
3. Admin clicks install → OAuth callback auto-stores `SLACK_BOT_TOKEN`
4. Future deploys auto-update the manifest via the config token

### Secrets reference

| Secret | Set by | Purpose |
|--------|--------|---------|
| `SLACK_CONFIG_TOKEN` | `mug slack setup` | Authorize Manifest API for auto-deploy |
| `SLACK_CONFIG_REFRESH_TOKEN` | `mug slack setup` | Rotate config token (12h expiry) |
| `SLACK_APP_ID` | `mug slack setup` or auto on create | Identify the Slack app |
| `SLACK_CLIENT_ID` | `mug slack setup` or auto on create | OAuth client identifier |
| `SLACK_CLIENT_SECRET` | `mug slack setup` or auto on create | OAuth client secret |
| `SLACK_SIGNING_SECRET` | `mug slack setup` or auto on create | Verify Slack request signatures |
| `SLACK_BOT_TOKEN` | Auto on OAuth install | Bot API access token |
| `SLACK_TEAM_ID` | Auto on OAuth install | Installed workspace ID |

## Deploy Process

`mug deploy` reads `slack.json` and:

1. Generates a Slack manifest (v2) from the config
2. Auto-infers OAuth scopes from enabled features
3. Merges workflow-level Slack triggers (slash commands, events) from `.ts` files
4. Compares scopes with last deploy — warns if new scopes require re-authorization
5. Creates or updates the Slack app via manifest API (requires config token from `mug slack setup`)
6. Stores homeTab and shortcuts config in R2 for runtime rendering

### Scope auto-inference

| Feature | Scopes added |
|---------|-------------|
| Always | `chat:write`, `channels:join`, `channels:read`, `groups:read`, `users:read`, `users:read.email`, `im:write`, `mpim:read`, `mpim:write`, `reactions:write`, `files:write` |
| Slash commands or shortcuts | `commands` |
| Home Tab | `users:read`, `users:read.email` |
| Messages Tab | `im:history` |
| Unfurl domains | `links:read`, `links:write` |
| Chat agents (`chat: true`) | `assistant:write`, `im:history`, `app_mentions:read` |
| Message events | `channels:history`, `groups:history` |

### Legacy migration

If `mug.json` has a `slack` key and no `slack.json` exists, `mug update` creates `slack.json` from the legacy config and prints a deprecation notice.

## Workflow Triggers

Slack triggers are defined in workflow `.ts` files, not in `slack.json`:

```typescript
import { workflow } from "@mugwork/mug";

// Slash command
workflow("dispatch", handler, {
  trigger: { type: "slack_command", command: "/dispatch", description: "Create a dispatch" },
});

// Event subscription
workflow("classify", handler, {
  trigger: { type: "slack_event", event: "message" },
});
```

These merge into the manifest automatically at deploy time.

## ctx.* Methods

See `.mug/docs/api.md` for full signatures.

- `ctx.notify.slack({ to, message, blocks?, thread_ts? })` — send Block Kit messages. `to` accepts `#channel-name`, `channel-name`, or channel ID (`C...`). Names are resolved automatically. Bot auto-joins public channels; private channels require manual invite via Integrations tab.
- `ctx.slack.updateMessage({ channel, ts, text?, blocks? })` — update a message after interaction
- `ctx.slack.openModal({ triggerId, view })` — open a modal from a slash command or shortcut
- `ctx.slack.updateModal({ viewId, view })` — update an open modal for multi-step flows. `viewId` from `ctx.params.viewId` in a `view_submission` handler.
- `ctx.slackApiCall(method, body)` — call any Slack Web API method directly

## Modal Forms

Modals collect structured input from users. Open from slash commands or shortcuts, handle submission in the same workflow.

### Submission params

When a user submits a modal with `callback_id: "mug:<workflow>:<action>"`, the workflow receives:

| Param | Type | Description |
|-------|------|-------------|
| `ctx.params.type` | `"view_submission"` | Distinguishes from slash_command and block_actions |
| `ctx.params.actionId` | string | The `<action>` part from the callback_id |
| `ctx.params.formValues` | object | Nested `{ block_id: { action_id: { value, selected_option } } }` |
| `ctx.params.metadata` | string | The `private_metadata` from the modal (stash context here) |
| `ctx.params.viewId` | string | For `ctx.slack.updateModal()` |
| `ctx.params.userId` | string | Who submitted |
| `ctx.params.userName` | string | Display name |
| `ctx.params.triggerId` | string | For chaining modals |

### Dynamic select menus

For dropdowns over large datasets, use `external_select` blocks and configure a `suggestions` mapping in `slack.json`:

```json
{
  "suggestions": {
    "customer-picker": {
      "database": "crm",
      "query": "SELECT name, id FROM customers WHERE name LIKE ? AND _mug_deleted_at IS NULL LIMIT 20"
    }
  }
}
```

- The `action_id` on the `external_select` block must match the key in `suggestions`
- The user's typed text is passed as a `%value%` LIKE parameter
- First column = display text, second column = value sent on submission
- Set `min_query_length: 1` on the block to require at least 1 character before searching
- For small option sets (under 100), use `static_select` instead — no config needed

## Slack Data

After app install, these tables auto-sync every 6 hours:
- `slack_users` — `user_id`, `email`, `display_name`
- `slack_channels` — `channel_id`, `name`
