# Workflows — Full API Reference

Workflows are multi-step automations that query data, apply AI logic, and take action. Register a workflow with `workflow()`, then run it with `mug run` or on a schedule.

For a guided walkthrough, use the `/workflow` skill. For the full WorkspaceContext API (all `ctx.*` methods, error handling, data patterns), see [api.md](api.md).

## Registering a workflow

```typescript
import { workflow } from "@mugwork/mug";

workflow("invoice-followup", async (ctx) => {
  // Find all overdue unpaid invoices
  const overdue = await ctx.query("SELECT * FROM invoices WHERE due_date < date('now') AND status = 'open'");

  for (const inv of overdue) {
    // Send a payment reminder SMS to each customer
    await ctx.notify.sms({
      to: inv.customer_phone as string,
      message: `Invoice #${inv.number} for $${inv.amount} is overdue. Please pay at your earliest convenience.`,
    });
  }

  // Return how many reminders were sent
  return { notified: overdue.length };
}, { description: "Sends SMS reminders to customers with overdue invoices" });
```

Workflows in `workflows/` are auto-discovered by `mug deploy` — no import needed.

### Workflow options

The third argument to `workflow()` is an optional options object:

```typescript
workflow("expensive-analysis", handler, {
  description: "Runs deep analysis on quarterly data and emails a summary to the CFO",
  billing: "ai.anthropic",
});
```

| Option | Type | Description |
|--------|------|-------------|
| `description` | `string` | Plain English description of what the workflow does. Displayed in the workspace explorer. Required for all workflows. |
| `billing` | `string` | Billing method for all `ctx.ai()` calls in this workflow. `"mug-metered"` (default) or a BYOK key name (e.g., `"ai.anthropic"`). See [ai.md](ai.md) for full billing precedence. |
| `maxOperations` | `number` | Max `ctx.action()` calls per run (default 100). Increase for batch workflows: `maxOperations: 500`. Workflow throws when cap is hit with count and cap in the error message. |

## Step descriptions

Add a `//` comment on the line immediately above each `ctx.*` call and `return` statement. The workspace explorer parses these into human-readable step descriptions.

```typescript
// Check for overdue invoices in QuickBooks
const overdue = await ctx.query(  "SELECT * FROM invoices WHERE due_date < date('now') AND status = 'open'");

// No overdue invoices, nothing to do
if (overdue.length === 0) return { skipped: true };

// Send a reminder SMS to each customer
for (const inv of overdue) {
  await ctx.notify.sms({ to: inv.phone as string, message: `Invoice #${inv.number} is overdue.` });
}

// Return a summary of how many reminders were sent
return { notified: overdue.length };
```

Every `ctx.query`, `ctx.exec`, `ctx.ai`, `ctx.notify.*`, `ctx.collect`, and `return` statement should have a description comment. Multi-line `//` comments above the same call are joined into a single description.

## WorkflowContext — ctx API

Every `ctx` method is automatically logged with timing, input/output summary, and token usage. Steps appear in `mug logs`.

For full method signatures, return types, error behavior, and data patterns, see [api.md](api.md). Quick reference of available methods:

| Method | Purpose |
|--------|---------|
| `ctx.query(sql, params?)` | Read rows from the workspace database |
| `ctx.exec(sql, params?)` | Write to the workspace database, returns change count |
| `ctx.ai(model, options)` | Call an AI model — use `"auto"` for smart routing. See [ai.md](ai.md) |
| `ctx.notify.email(options)` | Send styled HTML email with optional CTA. See [notifications.md](notifications.md) |
| `ctx.notify.sms(options)` | Send SMS via Twilio (E.164 format) |
| `ctx.notify.slack(options)` | Send Slack message |
| `ctx.surfaceUrl(id, path?)` | Generate dev/prod-aware surface URL |
| `ctx.file(path)` | Read file from `files/` as ArrayBuffer |
| `ctx.fileText(path)` | Read file from `files/` as UTF-8 string |
| `ctx.collect(options)` | Create a form dynamically, returns URL. See [forms.md](forms.md) |
| `ctx.secret(name)` | Read a workspace secret by name (from `.mug/secrets`). Throws if not found |
| `ctx.http(url, options?)` | Outbound HTTP. Returns `{ status, headers, body, json, ok }`. Throws on non-2xx. Auto-retries 429/connection errors |
| `ctx.action(connectorName)` | Returns ConnectorHandle for outbound CRUD. Methods: `.read(table, id)`, `.create(table, fields)`, `.update(table, id, fields)`, `.delete(table, id)`, `.upsert(table, id, fields)`. Auto-snapshots before transforms. See [api.md](api.md#ctxactionconnectorname) |
| `ctx.rollback(actionId)` | Undo a prior action using stored before-snapshot. See [api.md](api.md#ctxrollbackactionid) |
| `ctx.rollbackRun(workflowRunId)` | Roll back all actions from a run in reverse order. See [api.md](api.md#ctxrollbackrunworkflowrunid) |
| `ctx.agent(name, options)` | Invoke a custom AI agent. Returns `{ response, output?, usage, capped?, pendingApproval? }`. See [agents.md](agents.md) |
| `ctx.search(query, options?)` | Semantic similarity search across synced data. Returns ranked results. Requires deployed workspace. See [api.md](api.md#ctxsearch) |
| `ctx.ask(question, options?)` | Full RAG: search + LLM answer. Returns `{ answer, sources, usage }`. Requires deployed workspace. See [api.md](api.md#ctxask) |
| `ctx.waitFor(eventName, options?)` | Pause workflow until external event. Returns `{ payload, type, timedOut }`. Zero cost while waiting. See [api.md](api.md#ctxwaitfor) |
| `ctx.waitForUrl(eventName)` | Generate a one-time callback URL for embedding in notifications. See [api.md](api.md#ctxwaitforurl) |
| `ctx.respond(body, status?)` | Set custom webhook response. First call wins. For Slack challenge, Twilio TwiML |
| `ctx.params` | Input parameters (form fields, portal action data, webhook payload, trigger data) |
| `ctx.isDemo` | `true` when triggered from a demo mode surface |
| `ctx.steps` | Step records for the current run (used internally for logging) |

## WorkflowResult

Returned by `runWorkflow()` (internal). Visible in `mug logs`.

```typescript
interface WorkflowResult {
  workflow: string;
  runId: string;              // unique: <name>-<timestamp>-<random>
  status: "complete" | "errored";
  startedAt: string;          // ISO 8601
  completedAt: string;
  durationMs: number;
  stepCount: number;
  steps: StepRecord[];
  result?: unknown;           // return value from handler
  error?: string;             // error message if errored
}
```

## StepRecord

Each `ctx.*` call produces a step record.

```typescript
interface StepRecord {
  name: string;        // auto-generated: <type>-<target>-<counter>
  type: string;        // "query", "exec", "ai", "notify", "collect"
  startedAt: number;   // epoch ms
  completedAt?: number;
  durationMs?: number;
  input?: string;      // JSON, truncated to 4096 chars
  output?: string;     // JSON, truncated to 4096 chars
  error?: string;
  tokensUsed?: number; // AI steps only
}
```

## Ops database

Workflow runs are automatically persisted to the `_mug_ops` database with `workflow_runs` and `workflow_steps` tables. See [api.md — Ops database](api.md#ops-database) for the full schema.

## Scheduling

Add a `schedule` to the workflow options. Use a cron string for simple patterns or a structured object for complex ones:

```typescript
// Cron string
workflow("invoice-followup", handler, { schedule: "0 9 * * 1-5" });

// Structured: 3rd Tuesday at 9am, skip holidays
workflow("board-prep", handler, {
  schedule: { weekday: "tuesday", nth: 3, time: "09:00", skipHolidays: true },
});

// Structured: every 15 min from 2-4pm on Wednesdays
workflow("slot-check", handler, {
  schedule: { interval: "15m", between: ["14:00", "16:00"], weekday: "wednesday" },
});

// Structured: last Friday of the month
workflow("monthly-close", handler, {
  schedule: { weekday: "friday", nth: -1, time: "17:00" },
});
```

### Common cron expressions

| Expression | Meaning |
|-----------|---------|
| `*/15 * * * *` | Every 15 minutes |
| `0 * * * *` | Every hour |
| `0 9 * * 1-5` | Weekdays at 9am |
| `0 0 * * *` | Daily at midnight |
| `0 9 * * 1` | Mondays at 9am |
| `0 */6 * * *` | Every 6 hours |

### Schedule object fields

| Field | Type | Description |
|-------|------|-------------|
| `weekday` | `"monday"` .. `"sunday"` | Day of week |
| `nth` | `1-5` or `-1` | Nth weekday in month (-1 = last) |
| `time` | `"HH:MM"` | Time in 24h format |
| `interval` | `"15m"`, `"1h"`, `"6h"` | Repeat interval |
| `between` | `["14:00", "16:00"]` | Time window for interval |
| `skipHolidays` | `true` or `"US"` | Skip workspace holidays or a specific country |
| `skipDates` | `["2026-12-24"]` | Skip specific dates |
| `cron` | `"0 9 1 * *"` | Base cron pattern (combine with modifiers) |
| `timezone` | `"America/New_York"` | IANA timezone |

### Holiday calendar

Configure workspace holidays in `mug.json`:

```json
{
  "holidays": {
    "country": "US",
    "include": ["christmas-eve", "black-friday", "easter-monday"],
    "exclude": ["columbus-day-indigenous-peoples-day"]
  }
}
```

Public holidays are fetched from Nager.Date for the configured country. Built-in extras: `christmas-eve`, `black-friday`, `easter-monday`. Add custom rules:

```json
{ "name": "Company Retreat", "rule": "3rd wednesday of september" }
{ "name": "Founder's Day", "date": "2026-08-15" }
```

## Production execution

In production, workflows run as Cloudflare Workflows (durable execution). Each `ctx.*` call becomes a durable step — if the Worker restarts mid-execution, it resumes from the last completed step.

```bash
mug run <workflow>                   # run locally
mug run <workflow> --production      # run in production (creates CF Workflow instance)
mug status <workflow> <instanceId>   # check production instance status
mug logs <workflow>                  # view execution history (dev or production)
```

## CLI commands

```bash
mug run <workflow>                   # execute workflow locally
mug run <workflow> --production      # execute in production
mug status <workflow> <instanceId>   # check production workflow status
mug logs [workflow]                  # view execution logs (tries dev, falls back to production)
mug logs <workflow> --production     # view production logs explicitly
mug logs <workflow> --limit 20       # view more log entries
mug logs --json                      # JSON output for scripting
```

## Two-workflow pattern

For form-based workflows, use two workflows: one creates the form, another handles submissions.

```typescript
// workflows/create-intake-form.ts
import { workflow } from "@mugwork/mug";

workflow("create-intake-form", async (ctx) => {
  const url = await ctx.collect({
    title: "Client Intake",
    fields: [
      { name: "company", label: "Company Name", type: "text", required: true },
      { name: "revenue", label: "Annual Revenue", type: "number" },
    ],
    workflow: "handle-intake",
  });
  await ctx.notify.email({
    to: "client@example.com",
    message: `Please fill out the intake form: ${url}`,
    subject: "Client Intake Form",
  });
  return { formUrl: url };
});

// workflows/handle-intake.ts
import { workflow } from "@mugwork/mug";

workflow("handle-intake", async (ctx) => {
  const { company, revenue } = ctx.params;
  await ctx.exec("INSERT INTO clients (company, revenue) VALUES (?, ?)", [company, revenue]);
  await ctx.notify.slack({
    to: "#new-clients",
    message: `New intake: ${company} ($${revenue} revenue)`,
  });
});
```

## Trigger types

Workflows can be triggered by cron schedule, webhook, inbound message, or data change event. Configure in workflow options (third argument to `workflow()`).

### Webhook triggers

```typescript
workflow("process-stripe-event", async (ctx) => {
  if (ctx.params.type === "url_verification") {
    ctx.respond({ challenge: ctx.params.challenge });
    return;
  }
  const { type, data } = ctx.params;
  if (type === "invoice.paid") {
    await ctx.exec("UPDATE invoices SET status = 'paid' WHERE stripe_id = ?",
      [data.object.id as string]);
  }
}, { webhook: { auth: "hmac", secret: "STRIPE_WEBHOOK_SECRET" } });
```

URL: `POST https://api.mug.work/hook/<workspace>/<workflow>`. See [api.md — Webhook-Triggered Workflows](api.md#webhook-triggered-workflows).

### Event triggers

Fire a workflow when synced data changes:

```typescript
workflow("new-invoice-alert", async (ctx) => {
  const { source, table, event, count } = ctx.params._trigger;
  const rows = ctx.params.rows;
  for (const inv of rows) {
    await ctx.notify.email({
      to: "owner@company.com",
      subject: `New invoice: ${inv.number}`,
      message: `Amount: $${inv.amount}`,
    });
  }
}, { trigger: { source: "quickbooks", table: "invoices", on: "insert" } });
```

Trigger options: `source` (required), `table` (optional, defaults to all), `on` ("insert" | "update" | "delete" | "change"), `includeInitialSync` (default false — first full sync doesn't fire triggers).

### Outbound HTTP

Call external APIs or send webhooks from workflows:

```typescript
const result = await ctx.http("https://api.example.com/orders", {
  headers: { Authorization: `Bearer ${ctx.secret("API_KEY")}` },
});
const orders = result.json;

// Fire-and-forget webhook with HMAC signing
await ctx.http("https://partner.com/webhook", {
  method: "POST",
  body: { event: "order.shipped", orderId: "123" },
  sign: { secret: "PARTNER_HMAC_KEY" },
});
```

## Complete example

```typescript
import { workflow } from "@mugwork/mug";

workflow("daily-report", async (ctx) => {
  // 1. Query data from multiple sources
  const openTickets = await ctx.query("zendesk",
    "SELECT * FROM tickets WHERE status = 'open' AND _mug_deleted_at IS NULL");
  const overdueInvoices = await ctx.query(    "SELECT * FROM invoices WHERE due_date < date('now') AND status = 'unpaid'");

  // 2. AI summary
  const summary = await ctx.ai("balanced", {
    system: "Summarize operational status in 3-4 bullet points for the business owner.",
    prompt: `Open support tickets: ${openTickets.length}\n${openTickets.map(t => `- ${t.subject}`).join("\n")}\n\nOverdue invoices: ${overdueInvoices.length}\n${overdueInvoices.map(i => `- #${i.number}: $${i.amount}`).join("\n")}`,
  });

  // 3. Send report
  await ctx.notify.email({
    to: "owner@company.com",
    subject: `Daily Report — ${new Date().toLocaleDateString()}`,
    message: summary.text,
  });

  // 4. Log the report
  await ctx.exec(    "INSERT INTO reports (id, type, content, created_at) VALUES (?, ?, ?, ?)",
    [crypto.randomUUID(), "daily", summary.text, new Date().toISOString()]);

  return { tickets: openTickets.length, invoices: overdueInvoices.length };
});
```
