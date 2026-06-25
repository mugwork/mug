---
name: workflow
description: Create a new workflow — multi-step automation with data queries, AI classification, and notifications. Scaffolds the file and tests locally.
argument-hint: "<workflow name or description>"
---

# Create a Workflow

Build a multi-step workflow that queries data, applies AI logic, and takes action (notify, update records, etc.).

For full API reference (all ctx methods, WorkflowResult, ops database schema, production execution), see `.mug/docs/workflows.md`. For cross-cutting API reference (ctx.params shape, error handling, data patterns), see `.mug/docs/api.md`.

## Input

Workflow name or description: `$ARGUMENTS`

If no argument provided, ask the user what the workflow should do. Clarify:
- What data sources does it need? (which databases/tables)
- What logic or AI classification should it apply?
- What actions should it take? (SMS, email, Slack, update records, write back to external APIs via `ctx.action()`)
- Does it need to write back to external systems? (requires a bidirectional `connector()` — see `/connector` skill)
- Should it run on a schedule or only manually?

## Step 1 — Name and plan

Pick a kebab-case name for the workflow (e.g., `invoice-followup`, `lead-scoring`, `daily-report`).

Present a brief plan:
- Data queries needed
- AI classification steps (if any)
- Actions/notifications
- Estimated step count

Wait for user confirmation.

## Step 2 — Write the workflow

Create the file at `workflows/<name>.ts`:

```typescript
import { workflow } from "@mugwork/mug";

workflow("<name>", async (ctx) => {
  // Fetch all open items from the workspace database
  const rows = await ctx.query("SELECT ...");

  // Classify each item using AI with smart routing
  for (const row of rows) {
    const result = await ctx.ai("fast", {
      prompt: `<classification prompt using ${row.field}>`,
      system: "Reply with exactly one word.",
      maxTokens: 10,
    });
  }

  // Notify the relevant person about the results
  await ctx.notify.sms({ to: "...", message: "..." });

  // Return a summary of what happened
  return { summary: "..." };
}, {
  description: "<Plain English description of what this workflow does>",
  // webhook: true,  // or { auth: "hmac", secret: "WEBHOOK_SECRET" }
  // inbound: "sms",  // or "email" or "slack"
  // trigger: { source: "quickbooks", table: "invoices", on: "insert" },
});
```

### Descriptions

Every workflow must have a `description` in the options object — a plain English sentence explaining what the workflow does and why.

Every `ctx.*` call and `return` statement must have a `//` comment on the line above describing what it does. These comments appear in the workspace explorer as human-readable step descriptions.

```typescript
// Check for overdue invoices
const overdue = await ctx.query("SELECT * FROM invoices WHERE ...");

// Send a reminder SMS to the customer
await ctx.notify.sms({ to: inv.phone, message: "..." });

// No overdue invoices found, nothing to do
return { skipped: true };
```

### ctx API reference

- `ctx.query(sql, params?)` — query unified workspace database (table names auto-resolved across sources). `ctx.query("source", sql, params?)` for scoped queries.
- `ctx.exec(sql, params?)` — write to workspace database. Always use the one-arg form for your own tables. The two-arg form `ctx.exec("source", sql)` is only for writing back to a synced connector source — never pass a made-up database name. Schema evolution is automatic — adding columns to a CREATE TABLE IF NOT EXISTS will add them to the existing table without losing data.
- `ctx.ai(model, { prompt, system, maxTokens?, routing?, billing? })` — returns `{ text, model, usage, routing? }`
  - Use tier names: `"fast"` (cheap), `"balanced"` (mid), `"powerful"` (best). For multi-provider config and BYOK, see the `/ai` skill.
- `ctx.notify.email({ to, message, subject?, fromName?, cta? })` — send styled email with optional CTA button. For templates, surface links, and BYOK, use the `/notify` skill.
- `ctx.notify.sms({ to, message })` — send SMS
- `ctx.notify.slack({ to, message })` — send Slack message
- `ctx.surfaceUrl(surfaceId, path?)` — generate URL to a surface (dev/prod-aware). Use in notification CTAs.
- `ctx.file(path)` — read a file from `files/` as `ArrayBuffer` (local in dev, R2 in production)
- `ctx.fileText(path)` — read a file as UTF-8 string. Use for templates, CSV data, JSON configs.
- `ctx.collect(options)` — create a form that collects data from users. Returns the form URL. For the full form schema walkthrough (field types, conditionals, pages, access modes), use the `/form` skill.
- `ctx.secret(name)` — read a workspace secret by name (from `.mug/secrets`). Throws if not found. `ctx.credential(name)` is an alias — both work identically in workflows. Use for external API keys, tokens, or credentials.
- `ctx.waitFor(eventName, { timeout?, message? })` — pause workflow until external event. Returns `{ payload, type, timedOut }`. See Step 5.
- `ctx.waitForUrl(eventName)` — generate a one-time callback URL for embedding in notifications. See Step 5.
- `ctx.agent(name, { goal, context?, sessionKey?, caps? })` — invoke a custom AI agent. See the `/agents` skill.
- `ctx.http(url, options?)` — outbound HTTP request. Returns `{ status, headers, body, json, ok }`. Throws on non-2xx by default. Options: `{ method?, headers?, body?, throwOnError?: false, retry?: { attempts? } | false, timeout?, sign?: { secret, header? } }`. Auto-retries connection errors and 429 with exponential backoff.
- `ctx.respond(body, status?)` — set a custom HTTP response for webhook-triggered workflows. First call wins. Use for Slack URL verification, Twilio TwiML, etc.
- `ctx.search(query, { source?, limit? })` — semantic search across synced data. Returns `{ score, table, primaryKey, row }[]`. Requires deployed workspace.
- `ctx.ask(question, { source?, limit?, model?, system? })` — full RAG: searches data, feeds to LLM, returns `{ answer, sources, usage }`. Requires deployed workspace.

Drop files in the `files/` directory and run `mug push` to upload them to production. Check `.mug/manifest.json` for what's available remotely.

Every `ctx.*` call is automatically logged with timing, input/output, and token usage.

## Step 3 — Test locally

```bash
mug dev          # start the dev server (if not already running — auto-detects new workflows, no restart needed)
mug run <name>   # execute the workflow
```

Workflows in `workflows/` are auto-discovered — no import or restart needed.

Check the output:
- `[+]` = success, `[x]` = error
- Each step shows name, duration, and any errors
- AI steps show token usage

If the workflow errors, read the error message and fix. Common issues:
- Table doesn't exist yet → add `ctx.exec()` to create it, or sync the source first
- AI prompt returns unexpected format → adjust the prompt or add parsing
- `No credentials for "<name>"` → check `mug secret set` and `mug.json` connection config
- `AI not configured: missing MUG_AI service binding` → workspace needs to be deployed first, or check `mug dev` is running

All `ctx.*` methods throw on failure. Use try/catch when you want to handle errors gracefully (e.g., continue processing other items if one notification fails). See `.mug/docs/api.md` for the full error handling reference.

Workflows can also be triggered by webhooks — see `.mug/docs/api.md` for webhook config.

## Step 4 — (Optional) Pause for external events

Use `ctx.waitFor()` to pause a workflow until an external event arrives (approval, payment confirmation, reply). Zero cost while waiting.

```typescript
// Send an approval request with a callback URL
const callbackUrl = await ctx.waitForUrl("approval");
await ctx.notify.email({
  to: manager,
  message: "New request needs approval.",
  cta: { label: "Approve", url: `${callbackUrl}?action=approve` },
});

// Pause until the manager clicks or 48 hours pass
const event = await ctx.waitFor<{ action: string }>("approval", { timeout: "48 hours" });

if (event.timedOut) {
  await ctx.notify.sms({ to: submitter, message: "Your request timed out." });
} else if (event.payload?.action === "approve") {
  await ctx.exec("UPDATE requests SET status = ? WHERE id = ?", ["approved", requestId]);
}
```

- `ctx.waitForUrl(eventName)` — generates a one-time callback URL. When visited (GET or POST), it delivers the event.
- `ctx.waitFor(eventName, { timeout?, message? })` — pauses until the event arrives or timeout. Returns `{ payload, type, timedOut }`.
- Callback URLs expire after 7 days.
- In local dev, `waitFor` resolves immediately with an empty payload for testing.

For full signatures and options, see `.mug/docs/api.md`.

## Step 5 — View execution log

```bash
mug logs <name>                  # dev server or auto-fallback to production
mug logs <name> --production     # force production logs
```

Shows every run with per-step details: timing, inputs, outputs, token counts. If no dev server is running, automatically fetches production logs.

## Step 6 — (Optional) Add a schedule

Add a `schedule` option to your workflow. Use a cron string for simple patterns, or a structured object for complex ones:

```typescript
// Simple: cron string
workflow("daily-report", handler, {
  schedule: "0 9 * * 1-5",  // weekdays at 9am
});

// Complex: structured schedule
workflow("board-meeting-prep", handler, {
  schedule: {
    weekday: "tuesday",
    nth: 3,                    // 3rd Tuesday of the month
    time: "09:00",
    skipHolidays: true,        // skip workspace holidays
  },
});
```

### Cron strings (simple)

- `"*/15 * * * *"` — every 15 minutes
- `"0 9 * * 1-5"` — weekdays at 9am
- `"0 0 * * *"` — daily at midnight
- `"0 9 * * 1"` — Mondays at 9am

### Schedule object (complex)

| Field | Type | Description |
|-------|------|-------------|
| `weekday` | `"monday"` .. `"sunday"` | Day of week |
| `nth` | `1-5` or `-1` | Nth occurrence of weekday in month (-1 = last) |
| `time` | `"HH:MM"` | Time in 24h format |
| `interval` | `"15m"`, `"1h"`, `"6h"` | Repeat interval |
| `between` | `["14:00", "16:00"]` | Time window for interval |
| `skipHolidays` | `true` or `"US"` | Skip workspace holidays (true) or a specific country |
| `skipDates` | `["2026-12-24"]` | Skip specific dates |
| `cron` | `"0 9 1 * *"` | Base cron (use with modifiers like skipHolidays) |
| `timezone` | `"America/New_York"` | IANA timezone |

### Holiday calendar

Configure workspace holidays in `mug.json`:

```json
{
  "holidays": {
    "country": "US",
    "include": [
      "christmas-eve",
      "black-friday",
      "easter-monday",
      { "name": "Company Retreat", "rule": "3rd wednesday of september" }
    ],
    "exclude": ["columbus-day-indigenous-peoples-day"]
  }
}
```

Built-in holiday slugs: `christmas-eve`, `black-friday`, `easter-monday`. Custom rules use "Nth weekday of month" patterns. Exclude holidays by slug.

## Step 7 — Deploy

```bash
mug validate     # type-checks workspace code and runs 40+ validation rules
mug deploy       # runs validation, bundles, and deploys to production
```

`mug deploy` runs validation automatically — TypeScript type errors appear as warnings but don't block deploy. Scheduled workflows run automatically in production.

When a workflow errors in production, the workspace owner and admins receive an email with the error details, failed step, and duration. Duplicate emails for the same workflow are suppressed for 5 minutes. Errors are also visible in the explorer (`mug dev` → Errors tab).

To trigger manually in production:
```bash
mug run <name> --production
mug status <name> <instanceId>
```

## Inbound message routing

Receive SMS replies, inbound emails, and Slack interactions by routing them to a workflow. Configure via workflow options:

```typescript
workflow("handle-sms", handler, { inbound: "sms" });
workflow("handle-email", handler, { inbound: "email" });
workflow("handle-slack", handler, { inbound: "slack" });
```

Each inbound channel delivers different `ctx.params`:
- **SMS**: `{ from: "+1234567890", body: "Yes, approved" }`
- **Email**: `{ from: "user@example.com", subject: "Re: Invoice #42", body: "Looks good" }`
- **Slack**: `{ userId: "U12345", actionId: "approve_btn", actionValue: "yes" }`

Webhook URLs are shown after `mug deploy`: `https://api.mug.work/inbound/sms/<workspace>`, etc.

**Send-and-wait pattern**: Workflow 1 sends a notification and sets a status field in the database. Workflow 2 (the inbound handler) catches the reply and checks the status field to determine what to do.

For full inbound routing reference, see `.mug/docs/api.md`.

---

For collecting data from users (forms with submissions), see the `/form` skill.
For displaying data and approval UIs (list+detail pages with action buttons), see the `/portal` skill.
For email/SMS notifications with CTA buttons and surface links, see the `/notify` skill.
