![Mug](https://pub-b8207fa7ce394b47b9fc818bd5c45470.r2.dev/images/mug-cli-github-banner.png)

# Mug

[Mug](https://mug.work) is an AI automation platform for building deployed agents, real code workflows, & headless web surfaces for everyday business, integrated with any API, and accessed via email, SMS, & Slack — all built locally using Claude Code, Codex, & Cursor.

Ship complete AI operating systems for any business with the coding agent subscription you already pay for.

---

# Get Started with Mug CLI Agent Kit

## Install
Mug's CLI Agent Kit gives Claude, Codex, & Cursor everything they need to build anything on Mug — agentic CLI, CLAUDE.md/AGENTS.md, skills that teach the entire Mug platform, and the entire Mug docs library.


### Single-command global install
```
npm install -g @mugwork/mug
```

### Prompt your agent to install & learn how to use Mug in one shot
```
Install the Mug.work CLI Agent Kit by running `npm install -g @mugwork/mug`. After install, run `mug start`, then review the unpacked agent kit materials to help me get started.
```

## Human CLI

Mug is meant to be driven by a coding agent like Claude, Codex, or Cursor, but we wanted the CLI to be usable for humans too. Open a terminal and run `mug` from any directory. You'll be prompted to log in if you're not already, then the CLI walks you through everything interactively. Arrow keys to navigate, enter to select. No commands to memorize.

Scaffold a fresh local workspace or clone an existing workspace from the cloud. Navigate into a workspace to launch the Mug dev server + workspace explorer UI, validate + deploy workspaces, browse the entire contents of a workspace, and even manage billing.

## Agentic CLI

AI coding agents like Claude, Codex, & Cursor are who the Mug CLI was really designed for. They drive the CLI via bash commands:

```bash
mug login                          # authenticate
mug init <name>                    # create new workspace
mug clone                          # clone existing workspace from cloud
mug dev                            # start local dev server
mug deploy                         # deploy to production
mug --help                         # full command reference
```

Your coding agent can build everything the Mug platform supports by using the CLI and the agent kit materials bundled in your workspace.

## Set up a new workspace

### Manually via terminal
1. Run `mug` from any directory
2. Select `Create New Workspace` from menu
3. Create or navigate to the folder you want to put your workspace in
4. Select `Scaffold workspace here` from menu

Now launch your coding agent from the workspace directory and it will automatically pick up all agent kit materials in the workspace: CLAUDE.md/AGENTS.md, skills, and Mug docs.

### Prompt your agent
```
Run `mug init` to create a new Mug workspace called [name of your new workspace] in [directory you want workspace in]
```

**IMPORTANT**: After agent scaffolds your new workspace, re-launch your coding agent from the new workspace directory so it automatically picks up all agent kit materials in the workspace: CLAUDE.md/AGENTS.md, skills, and Mug docs.

## Auto Update

The Mug CLI keeps workspaces in sync with Mug platform improvements by automatically updating global CLI npm package and all agent kit materials: CLAUDE.md/AGENTS.md, skills, and Mug docs.

## Start

Use /start skill for a quick guide on what you and your agent can do with Mug.

---

# What's In a Workspace

**Workspaces are repos** you build locally, then deploy to tenant-isolated Cloudflare via `mug deploy`. Optionally sync your workspace to GitHub for a backup with full git functionality.

```
acme-workspace/
├── .agents/skills/           # Agent skills (Codex, etc.)
├── .claude/skills/           # Claude Code skills
├── .cursor/rules/            # Cursor IDE rules
├── .mug/docs/                # Platform API reference
├── agents/                   # AI agents
│   ├── dispatch-agent/
│   │   ├── agent.json        # Config: model, tools, caps, memory
│   │   ├── BRAIN.db          # Persistent agent memory
│   │   ├── SOUL.md           # Core identity & instructions
│   │   └── skills/           # Agent-specific skills
│   ├── invoice-agent/
│   │   └── ...
│   └── shared-skills/        # Skills available to all agents
├── connectors/               # Data sync from external APIs
├── databases/                # Local SQLite (synced to production)
├── files/                    # Static files synced to R2
├── surfaces/                 # Forms, portals, dashboards
├── workflows/                # Scheduled & triggered automation
├── AGENTS.md                 # Auto-generated agent instructions
├── CLAUDE.md                 # Auto-generated — teaches AI agents Mug's API
├── mug.json                  # Workspace config
├── slack.json                # Slack app config
└── package.json
```

- Workspaces are scaffolded via `mug init` or `mug clone` and kept up-to-date with Mug platform via `mug update`
- Mug primitives live in 4 top-level directories — `/connectors`, `/workflows`, `/agents`, & `/surfaces`
- Workspace files and databases live in `/files` and `/databases` and are manually push/pulled to/from cloud via `mug push` and `mug pull`
- Agent Kit ships with all Mug platform skills and docs so cold agents learn how to build anything in Mug in minutes
- TypeScript for automation workflows, SQL for data, JSON for configuring AI agents and surfaces, and Markdown for agent instructions and skills

---

# Custom Deployed Agents

**Mug agents run 150+ models supported by [Cloudflare AI Gateway](https://developers.cloudflare.com/ai/models/)** — Anthropic, OpenAI, Google, Meta, DeepSeek, & more. Unlike always-on agents that burn tokens waiting for work, Mug agents turn on when a workflow pings them, then go back to sleep.

```
dispatch-agent/
├── agent.json        # Config: model, tools, caps, memory
├── BRAIN.db          # Persistent agent memory
├── SOUL.md           # Core identity & instructions
└── skills/           # Agent-specific skills
```

```json
{
  "model": { "fast": "claude-haiku", "balanced": "claude-sonnet", "powerful": "claude-opus" },
  "tools": ["query", "search", "notify", "http", "trigger_workflow"],
  "memory": true,
  "caps": { "maxTurns": 30, "maxCredits": 200, "maxDuration": 300 },
  "chat": true
}
```

- Each agent has a SOUL.md for identity, a BRAIN.db database for memory, and a folder of skills — plus shared skills available to every agent in the workspace
- Agents write journal entries during work to build their own "mantra" — a self-authored summary of critical context they accumulate over their lifetime
- Agents can query data with SQL, run vector search and RAG, send emails, SMS, and Slack messages, call APIs, and trigger other workflows
- Set fast / balanced / powerful model tiers and Mug routes to the right one based on task complexity — or bring your own API keys to skip Mug's credit system entirely

---

# TypeScript Automation Workflows

**Workflows are TypeScript functions** that run on a schedule, trigger automatically when data changes, or get invoked by an AI agent — written by you and your coding agent.

```typescript
workflow("weekly-invoice-followup", async (ctx) => {
  const overdue = await ctx.query("finance", "SELECT * FROM invoices WHERE due_date < date('now') AND status = 'unpaid'");
  const draft = await ctx.ai("balanced", { prompt: `Draft follow-up emails for these invoices: ${JSON.stringify(overdue)}`, system: "You are a collections specialist." });
  await ctx.notify.email({ to: "accounting@acme.com", subject: "Overdue Invoice Report", message: draft });
}, { schedule: { weekday: "friday", time: "09:00" } });
```

- Schedule workflows to run when you need them — Fridays at 9am, 3rd Tuesday of the month, every 15 mins from 2-4pm on Wednesdays
- Workflows can fire when synced data changes, when an inbound webhook arrives, or when an agent receives an email to their custom email address
- Workflows can be made available in Slack as slash commands
- Mug agents can run as workflow steps — reading data, making decisions, and routing the workflow down different branches based on what they find
- Workflows can push data back to any connected API via `ctx.action()` — Mug automatically snapshots every record before changing it, so any action can be rolled back
- Every workflow step is checkpointed with durable execution — if something fails mid-run, only that step retries and all prior work is preserved

---

# Universal API Sync Connectors

**Mug connects to any API** you and your coding agent can build a connector for. Sync a read-only copy of live business data into local SQLite to build agents and workflows on top.

```typescript
source({
  name: "quickbooks",
  database: "finance",
  tables: [{
    name: "invoices",
    primaryKey: "Id",
    fetch: async (ctx) => {
      const res = await ctx.http("https://quickbooks.api.intuit.com/v3/company/...");
      return res.json.QueryResponse.Invoice;
    }
  }]
});
```

- Mug CLI ships with a multi-step connector skill that walks your agent through researching any API and building a connector from scratch
- Connectors pull data on the interval you set — up to every minute on Business plans — and only process records that have changed since last sync
- Synced data is stored as SQLite, a format AI agents work with natively — once data is in Mug, it's simple SQL to join records across any table or database, regardless of the source
- Upload files and folders directly in your workspace to be used by agents and utilized in workflows alongside business data
- Any external edits to data happen through separate workflows outside the sync process — Mug never bulk updates external data
- Mug crowdsources and maintains a pre-built connector library [here](https://github.com/mugwork/mug-connectors)

---

# Headless Web Surfaces

**No one wants a new app.** Mug uses headless "click and close" web surfaces to reach people where they already are, on any device — forms, portals, dashboards, etc — all configured with just a few lines of JSON, no UI design necessary.

[Click here to demo surfaces](https://demo.mug.work)

```json
{
  "type": "form",
  "title": "Time Off Request",
  "access": { "mode": "auth", "table": { "database": "hr", "table": "employees", "column": "email" } },
  "fields": [
    { "name": "type", "label": "Type", "type": "select", "options": ["PTO", "Sick", "Personal"] },
    { "name": "start_date", "label": "Start Date", "type": "date" },
    { "name": "notes", "label": "Notes", "type": "textarea" }
  ],
  "handler": "handle-time-off"
}
```

- Surfaces support user login via email or SMS, letting you build personalized, secure interfaces for each user
- Surfaces are progressive web apps — users are auto-prompted to save to their home screen for an app-like experience, without the app store
- Mug has Resend and Twilio built-in to notify users across email, SMS, and Slack — bring your own API keys for unlimited sends
- Custom branding with your logo and accent color applied across all surfaces and emails
- Share surfaces with stakeholders in demo mode — pre-authenticated links with notification routing controls

---

# Automatic Slack App

**Every agent and workflow you create in Mug automatically gets wrapped in a custom Slack app** you can install in a couple clicks — no App Directory review needed.

```typescript
workflow("handle-approve", async (ctx) => {
  const { userId, actionValue } = ctx.params;
  await ctx.exec("ops", "UPDATE requests SET status = 'approved' WHERE id = ?", [actionValue]);
  await ctx.notify.slack({ to: "#approvals", message: `Request ${actionValue} approved by <@${userId}>` });
}, { inbound: "slack" });
```

- DM your Mug agents directly in Slack for threaded AI conversations, with multi-agent routing via @mentions
- Trigger any workflow with a slash command — someone types the command, the workflow runs
- Use Slack's Block Kit for interactive flows inside Slack — approval buttons, modals, rich formatting
- Slack user and channel data auto-syncs into your workspace database for use in workflows
- Mug handles all the OAuth, event routing, token rotation, and manifest API deployment — you just write the TypeScript

---

# Links

- [Mug.work](https://mug.work) — product site
- [Mug Connectors](https://github.com/mugwork/mug-connectors) — ready-to-use API sync connectors for Mug
- [Demo Surfaces](https://demo.mug.work) — interactive headless web surface examples

---

# Support / Contact

- Contact: Founder / Chief Vibe Coder — Tyler Berggren | [tyler@mug.work](mailto:tyler@mug.work) | [LinkedIn](https://www.linkedin.com/in/tyler-berggren)
- [Open an issue](https://github.com/mugwork/mug/issues)