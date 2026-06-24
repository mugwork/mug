# Mug API Reference

Unified reference for all cross-cutting APIs, data patterns, configuration, and CLI commands. Feature-specific types (form fields, portal config, source definitions) live in their own docs — this document covers everything that spans multiple features.

## WorkspaceContext (ctx)

Every workflow receives a `ctx` object with these methods. All methods are automatically logged with timing, input/output, and token usage. Logs are visible via `mug logs`.

All `ctx.*` methods **throw on failure**. Wrap in try/catch if you need to handle errors gracefully. In production (Cloudflare Workflows), each `ctx.*` call is a durable step — if the Worker restarts mid-execution, it resumes from the last completed step.

### ctx.query(sql, params?) / ctx.query(source, sql, params?)

Query the unified workspace database. All connector data lives in one database with prefixed table names (`{source}_{table}`). When a table name is unique across sources, the resolution engine rewrites SQL automatically — use the plain name.

```typescript
// Primary — query across all sources (table names auto-resolved)
async query(sql: string, params?: (string | number | null)[]): Promise<Record<string, unknown>[]>

// Scoped — query within one source (prefix added automatically)
async query(source: string, sql: string, params?: (string | number | null)[]): Promise<Record<string, unknown>[]>
```

```typescript
// Cross-source JOIN — the core value of the unified database
const rows = await ctx.query(
  "SELECT p.address, i.amount FROM airtable_properties p JOIN quickbooks_invoices i ON p.id = i.property_id"
);

// Auto-resolved — "contacts" resolves to "hubspot_contacts" if unique across sources
const contacts = await ctx.query("SELECT * FROM contacts WHERE status = ?", ["active"]);

// Scoped to one source — "properties" auto-prefixed to "airtable_properties"
const props = await ctx.query("airtable", "SELECT * FROM properties WHERE status = 'active'");
```

- All synced data lives in one unified workspace database. Table names are prefixed with the source name (`airtable_contacts`, `quickbooks_invoices`).
- **Auto-resolution**: if a table name is unique across all sources, use it without the prefix. If ambiguous (e.g., `contacts` in both airtable and hubspot), use the prefixed name or you'll get a clear error listing the options.
- Always use `?` placeholders for parameterized queries (prevents SQL injection)
- Locally, each source has its own `databases/<source>.db` file. `mug sql <source> <sql>` queries these directly (no prefix needed). The dev server merges them into a unified DO.

**Throws:** SQL syntax errors, table not found, ambiguous table name (with suggestions).

### ctx.exec(sql, params?) / ctx.exec(source, sql, params?)

Write to the workspace database. Returns the number of rows changed.

```typescript
// Write to workspace — use this for all tables you create
async exec(sql: string, params?: (string | number | null)[]): Promise<number>

// Write scoped to a synced connector source — prefix added automatically
// ONLY use this when writing back to a connector source (e.g., bidirectional sync)
async exec(source: string, sql: string, params?: (string | number | null)[]): Promise<number>
```

**Always use the one-arg form for your own tables.** The two-arg form is only for writing back to a synced connector source. Never pass a made-up database name like `"main"` or `"app"` — your tables live in the unified workspace database alongside synced data.

```typescript
// Correct — one-arg form, table lives in the workspace database
await ctx.exec("CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, message TEXT, sent_at TEXT)");
await ctx.exec("INSERT INTO alerts (id, message, sent_at) VALUES (?, ?, ?)",
  [crypto.randomUUID(), "Payment received", new Date().toISOString()]);

// WRONG — don't pass a database name for your own tables
// await ctx.exec("main", "CREATE TABLE IF NOT EXISTS alerts ...");
```

Common patterns:
```typescript
// Upsert
await ctx.exec(`INSERT INTO alerts (id, message, sent_at) VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET message = excluded.message, sent_at = excluded.sent_at`,
  [id, message, new Date().toISOString()]);

// Delete
await ctx.exec("DELETE FROM alerts WHERE sent_at < ?", [cutoffDate]);
```

**Throws:** SQL syntax errors, constraint violations, ambiguous table name.

### ctx.ai(model, options)

Call an AI model. Use tier names (`"fast"`, `"balanced"`, `"powerful"`) to pick the cost level — the tier resolves to your workspace's configured model. See [ai.md](ai.md) for the full AI reference including model catalog and BYOK.

**You must set `prompt` (user message) and `system` (system prompt).** These are passed directly to the model — you have full control over what the AI sees.

```typescript
async ai(
  model: string,    // "fast", "balanced", "powerful" (recommended), "auto", or "provider/model"
  options: {
    prompt: string;           // user message — the data/question
    system?: string;          // system prompt — instructions for how to respond
    maxTokens?: number;       // default: 1024
    routing?: { fast?: string; balanced?: string; powerful?: string };
    billing?: string;         // "mug-metered" (default) or BYOK key name
  }
): Promise<{
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  routing?: { tier: "fast" | "balanced" | "powerful"; model: string; provider: string; reason: string };
}>
```

```typescript
const result = await ctx.ai("fast", {
  prompt: `Classify this ticket as "billing", "technical", or "general":\n\n${ticket.body}`,
  system: "Reply with exactly one word.",
  maxTokens: 10,
});
// result.text = "billing"
// result.routing = { tier: "fast", model: "gpt-5.4-nano", provider: "openai", reason: "tier:fast" }
```

**Throws:** API rate limits, invalid model, network errors, BYOK key not found. In production, AI calls auto-retry (2 retries, exponential backoff).

### ctx.search(query, options?)

Semantic similarity search across synced data. Embeds the query, searches the workspace's Vectorize index, and returns ranked results with full row data from SQLite.

```typescript
async search(
  query: string,
  options?: {
    source?: string;                    // scope to one table name
    limit?: number;                     // topK results, default 10, max 50
    filter?: Record<string, string>;    // Vectorize metadata filter
  }
): Promise<{
  score: number;
  table: string;
  primaryKey: string;
  row: Record<string, unknown>;
}[]>
```

```typescript
const results = await ctx.search("roof leak complaints", { source: "jobs", limit: 5 });
for (const r of results) {
  console.log(`${r.table}:${r.primaryKey} (${r.score.toFixed(3)}) — ${r.row.description}`);
}
```

All synced text columns are automatically embedded during source sync — no configuration needed. Results are deduplicated by primary key (if a row produced multiple chunks, only the highest-scoring match is returned).

**Requires:** deployed workspace (Vectorize has no local emulation). Use FTS5 keyword search in local dev — see below.

**FTS5 keyword search (works locally):** every synced table gets an auto-created `{table}_fts` full-text index. Query directly via `ctx.query()`:
```typescript
const results = await ctx.query(
  `SELECT * FROM contacts JOIN contacts_fts ON contacts.rowid = contacts_fts.rowid
   WHERE contacts_fts MATCH ? ORDER BY rank LIMIT 10`,
  ["roof leak"]
);
```

### ctx.ask(question, options?)

Full RAG — retrieves relevant data via `ctx.search()`, formats it as context, and sends to an LLM for a grounded natural language answer.

```typescript
async ask(
  question: string,
  options?: {
    source?: string;       // scope search to one table
    limit?: number;        // topK for retrieval, default 10
    model?: string;        // LLM model/tier, default "balanced"
    system?: string;       // additional system prompt context
  }
): Promise<{
  answer: string;
  sources: SearchResult[];
  usage: { input_tokens: number; output_tokens: number; search_results: number };
}>
```

```typescript
const result = await ctx.ask("Which jobs had roof complaints last month?", {
  source: "jobs",
  system: "You are an operations assistant for an HVAC company.",
});
// result.answer = "Based on the records, 3 jobs mentioned roof issues: ..."
// result.sources = [{ score: 0.87, table: "jobs", primaryKey: "J-1234", row: {...} }, ...]
// result.usage = { input_tokens: 2100, output_tokens: 340, search_results: 10 }
```

Context window management: results are included until ~3000 tokens of context, prioritizing higher-scored results. The LLM is instructed to cite which records informed its answer.

**Requires:** deployed workspace (uses Vectorize + AI).

### ctx.embed(texts)

Generate vector embeddings for an array of strings. Used internally by `ctx.search()`, but available for custom similarity matching, clustering, or deduplication.

```typescript
async embed(texts: string[]): Promise<number[][]>
```

```typescript
const vectors = await ctx.embed(["urgent plumbing repair", "routine maintenance"]);
// vectors = [[0.12, -0.34, ...], [0.56, 0.78, ...]]  (768-dimensional)
```

Automatically batches in groups of 100. Each text produces one 768-dimensional vector. **Requires:** deployed workspace (uses AI service).

### ctx.notify.email(options)

Send a styled HTML email with optional CTA button. Workspace branding (logo, accent color) is applied automatically.

```typescript
async email(options: {
  to: string;
  message: string;        // supports basic markdown
  subject?: string;       // default: "Notification from <Workspace Name>"
  fromName?: string;      // default: workspace name titlecased
  cta?: { label: string; url: string };
}): Promise<string>       // returns status: "delivered", "logged", "blocked", "skipped"
```

**Markdown support:** `**bold**`, `*italic*`, unordered lists (`- item`), ordered lists (`1. item`), `[links](url)`. Headers, code blocks, tables, and images are **not** supported.

```typescript
await ctx.notify.email({
  to: "manager@company.com",
  subject: `New request from ${name}`,
  message: `**${name}** submitted a service request.\n\n- Type: ${type}\n- Urgency: ${urgency}`,
  cta: { label: "Review Request", url: ctx.surfaceUrl("approvals", `/row/${requestId}`) },
});
```

In local dev, emails redirect to `dev.email` in `mug.json` (auto-set to logged-in user). Subject shows original recipient. Dev mode proxies through the Mug platform notify service — no local Resend key needed.

**Returns:** Status string — `"delivered"` (sent successfully), `"logged"` (recorded but not delivered), `"blocked"` (no dev redirect configured), `"skipped"` (dev proxy unreachable), `"suppressed"` (demo mode suppressed the notification).

### ctx.notify.sms(options)

Send an SMS via Twilio. Works out of the box using Mug's platform number. BYOK optional for your own number.

```typescript
async sms(options: {
  to: string;       // E.164 format: +1234567890
  message: string;  // plain text
}): Promise<string>       // returns status: "delivered", "logged", "blocked", "skipped", "suppressed"
```

**Returns:** Same status strings as `ctx.notify.email()`.

**SMS works out of the box** using Mug's platform number. **Optional BYOK** — use your own number for custom caller ID and unmetered sends:

```bash
mug secret set TWILIO_ACCOUNT_SID=AC...
mug secret set TWILIO_AUTH_TOKEN=...
mug secret set TWILIO_PHONE_NUMBER=+15551234567
```

BYOK SMS sends are not metered against your plan's SMS limits. Mug's platform number is outbound-only. For inbound SMS (bidirectional), bring your own Twilio number and point its webhook to `https://api.mug.work/inbound/sms/<workspace>`.

### ctx.notify.slack(options)

Send a Slack message. Supports raw Block Kit blocks for rich formatting, threading, and link unfurling.

```typescript
async slack(options: {
  to: string;              // channel ID, channel name, or user ID
  message: string;         // fallback text (shown in notifications and non-Block Kit clients)
  blocks?: unknown[];      // Block Kit blocks — use for rich formatting, buttons, sections
  thread_ts?: string;      // reply in thread (message timestamp of parent)
  unfurl_links?: boolean;  // unfurl URL previews (default: Slack's default)
  unfurl_media?: boolean;  // unfurl media previews (default: Slack's default)
}): Promise<string>        // returns status: "delivered", "logged", "blocked", "skipped", "suppressed"
```

```typescript
// Plain text
await ctx.notify.slack({ to: "#ops-alerts", message: "New job assigned" });

// Block Kit with action buttons
await ctx.notify.slack({
  to: "C01234ABCDE",
  message: "Approval needed",
  blocks: [
    { type: "section", text: { type: "mrkdwn", text: `*New job:* ${job.title}` } },
    { type: "actions", elements: [
      { type: "button", text: { type: "plain_text", text: "Approve" },
        action_id: "mug:handle-approval:approve", value: job.id, style: "primary" },
    ]},
  ],
});

// Threading
await ctx.notify.slack({ to: channelId, message: "Update", thread_ts: originalTs });
```

Action ID convention: `mug:<workflow>:<custom>` routes button clicks to specific workflows. See the `/slack` skill for full Block Kit patterns.

### ctx.notify.channel(name, options)

Generic notification sender for custom channels. The built-in `email`, `sms`, and `slack` methods are convenience wrappers around this.

```typescript
async channel(name: string, options: {
  to: string;
  message: string;
  subject?: string;
  fromName?: string;
  cta?: { label: string; url: string };
}): Promise<string>
```

The channel name is passed to the dispatch notification service. Standard channels (`email`, `sms`, `slack`) route to their respective providers. Custom channel names are logged but require a matching provider configuration on the platform side.

### ctx.surfaceUrl(surfaceId, path?)

Generate a URL to a workspace surface. Automatically returns the correct URL for dev or production.

```typescript
surfaceUrl(surfaceId: string, path?: string): string
```

```typescript
ctx.surfaceUrl("approvals")
// dev:  "http://localhost:8787/approvals"
// prod: "https://my-workspace.mug.work/approvals"

ctx.surfaceUrl("portal", `/row/${id}`)
// dev:  "http://localhost:8787/portal/row/42"
// prod: "https://my-workspace.mug.work/portal/row/42"
```

Use in notification CTAs instead of hardcoding URLs.

### ctx.file(path)

Read a file from the workspace `files/` directory. Returns the file content as an `ArrayBuffer`. In dev, reads from local `files/` directory. In production, reads from R2 via content-addressed blob storage.

```typescript
file(path: string): Promise<ArrayBuffer>
```

```typescript
const logoBuffer = await ctx.file("branding/logo.png");
const csvData = await ctx.file("data/price-list.csv");
```

Throws if the file is not found. Drop files in `files/` and run `mug push` to upload them to production.

### ctx.fileText(path)

Convenience wrapper that reads a file as a UTF-8 string.

```typescript
fileText(path: string): Promise<string>
```

```typescript
const template = await ctx.fileText("templates/invoice.html");
const config = JSON.parse(await ctx.fileText("config/rules.json"));
```

### ctx.collect(options)

Create a form that collects data from users. Returns the live form URL. See [forms.md](forms.md) for all field types, conditionals, multi-page forms, and access modes.

```typescript
async collect(options: CollectOptions): Promise<string>
```

```typescript
const url = await ctx.collect({
  title: "Service Request",
  fields: [
    { name: "name", label: "Your Name", type: "text", required: true },
    { name: "issue", label: "Describe the issue", type: "textarea" },
  ],
  workflow: "handle-service-request",
});
```

The `id` option controls the URL path segment. If omitted, a random 8-character ID is generated. Use a fixed `id` for predictable URLs.

### ctx.waitFor(eventName, options?)

Pause the workflow until an external event arrives. The workflow waits at zero cost — no compute charges while paused. Returns when the event is received or the timeout expires.

```typescript
async waitFor<T>(eventName: string, options?: WaitForOptions): Promise<WaitForResult<T>>
```

**Options:** `{ timeout?: string | number, message?: string }`
- `timeout` — how long to wait. CF duration format: `"1 hour"`, `"30 minutes"`, `"7 days"`. Default: `"24 hours"`. Max: `"365 days"`.
- `message` — human-readable description (for logging/UI).

**Returns:** `{ payload: T, type: string, timedOut: boolean }`

```typescript
// Send approval email, then wait for response
const callbackUrl = await ctx.waitForUrl("approval");
await ctx.notify.email({
  to: "manager@example.com",
  subject: "Expense approval needed",
  message: `${employee} submitted $${amount} for ${category}.`,
  cta: { label: "Approve", url: `${callbackUrl}?action=approve` },
});
const result = await ctx.waitFor<{ action: string }>("approval", { timeout: "48 hours" });
if (result.timedOut) {
  await ctx.notify.email({ to: employee, message: "Your request timed out." });
} else if (result.payload.action === "approve") {
  await ctx.exec("UPDATE requests SET status = 'approved' WHERE id = ?", [requestId]);
}
```

In local dev, `waitFor` resolves immediately with an empty payload for testing.

### ctx.waitForUrl(eventName)

Generate a one-time callback URL for embedding in notifications. When the URL is visited (GET) or POSTed to, it sends the matching event to the waiting workflow.

```typescript
async waitForUrl(eventName: string): Promise<string>
```

```typescript
const url = await ctx.waitForUrl("approval");
// url: https://api.mug.work/_callback/abc-123-...
// Embed in email CTA, SMS, Slack button, etc.

// Approve/reject with different actions:
await ctx.notify.email({
  to: manager,
  message: "Review this request.",
  cta: { label: "Approve", url: `${url}?action=approve` },
});
// For reject, use the same callback URL with a different action query param
```

Callback URLs expire after 7 days. The event payload includes `{ action, respondedVia: "callback" }` plus any additional query parameters.

### ctx.http(url, options?)

Outbound HTTP request. Returns a result object. Throws `HttpError` on non-2xx by default. Auto-retries connection errors and 429 (rate limit) with exponential backoff.

```typescript
async http(url: string, options?: HttpOptions): Promise<HttpResult>

interface HttpOptions {
  method?: string;           // default "GET"
  headers?: Record<string, string>;
  body?: unknown;            // JSON-serialized if object, string as-is
  throwOnError?: boolean;    // default true — throw HttpError on non-2xx
  retry?: { attempts?: number } | false;  // default: auto-retry connection + 429 only
  timeout?: number;          // ms, default 30000
  sign?: { secret: string; header?: string };  // HMAC-SHA256 signing
}

interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  json: unknown;  // parsed if content-type is JSON, null otherwise
  ok: boolean;    // true for 200-299
}
```

```typescript
// GET with auth
const result = await ctx.http("https://api.example.com/orders", {
  headers: { Authorization: `Bearer ${ctx.secret("API_KEY")}` },
});
const orders = result.json;

// POST with auto-JSON
await ctx.http("https://hooks.slack.com/services/T.../B.../xxx", {
  method: "POST",
  body: { text: "Invoice approved" },
});

// Don't throw on error — handle manually
const res = await ctx.http("https://api.example.com/check", { throwOnError: false });
if (!res.ok) { /* handle */ }

// HMAC signing (outbound webhook)
await ctx.http("https://partner.com/webhook", {
  method: "POST",
  body: { event: "order.shipped", id: "123" },
  sign: { secret: "PARTNER_HMAC_KEY", header: "X-Hub-Signature-256" },
});
```

**Retry behavior:** Connection errors and 429 responses auto-retry with exponential backoff (3 attempts). All other errors throw immediately. Set `retry: false` to disable, or `retry: { attempts: 5 }` for more attempts.

**Metering:** Each `ctx.http()` call counts as 1 operation (not per retry).

### ctx.respond(body, status?)

Set a custom HTTP response for webhook-triggered workflows. First call wins — subsequent calls are no-ops. If never called, the webhook returns `{ ok: true }`.

```typescript
async respond(body: unknown, status?: number): Promise<void>
```

```typescript
// Slack URL verification
if (ctx.params.type === "url_verification") {
  await ctx.respond({ challenge: ctx.params.challenge });
  return;
}

// Custom status code
await ctx.respond({ error: "Invalid payload" }, 400);
```

### ctx.params

Parameters passed to the workflow. The shape depends on how the workflow was triggered:

#### Form submission

User-submitted field values plus metadata:

```typescript
{
  name: "Alice Smith",          // form field values (by field name)
  email: "alice@example.com",
  photo: "https://r2.mug.work/workspace/uploads/abc123.jpg",  // file uploads → R2 URLs
  _verified_email: "alice@example.com",   // verified identity (identify/auth mode)
  _verified_phone: "+1234567890",         // verified identity (phone mode)
  _auth_row: { id: 1, name: "Alice Smith", department: "Engineering", ... },  // full auth table row (auth mode)
  _surface: "intake-form",               // surface ID
  _workspace: "my-workspace",            // workspace name
  _edit: true,                            // present when editing existing record
  _editRecord: { id: "123", ... },        // original record data (edit mode)
}
```

- **File upload fields** contain R2 URL strings, not binary data
- `_verified_email` / `_verified_phone` are only present when the form uses `identify` or `auth` access mode
- `_auth_row` is the auth row — only present with `auth` access mode. Contains all columns from the auth table, plus any computed columns if the access config uses `query`. Use it to access any user attribute (department, role, manager_id, balances, etc.) without a separate query
- `_edit` and `_editRecord` are only present when the form uses `editMode`
- **Locked field values** are enforced server-side — the handler receives the known source value regardless of what was submitted

#### Portal action

All row data plus action metadata:

```typescript
{
  action: "approve",                      // the action name from portal config
  id: 123,                                // row data fields from the query
  employee_name: "John",
  status: "pending",
  _verified_email: "manager@example.com", // session identity
  _surface: "approvals",                  // portal surface ID
  _workspace: "my-workspace",
}
```

#### Webhook

The POST body of the incoming webhook request:

```typescript
{
  workspace: "my-workspace",
  workflow: "process-event",
  // ... all fields from the webhook POST body
}
```

#### Event trigger (data change)

When a workflow has `trigger: { source, table, on }` in its options and synced data changes:

```typescript
{
  _trigger: {
    source: "quickbooks",    // source that changed
    table: "invoices",       // table that changed
    event: "insert",         // "insert" | "delete"
    count: 3,                // number of affected rows
  },
  rows: [...],               // inserted/updated rows (on insert events)
  deletedPks: [...],         // deleted primary keys (on delete events)
}
```

#### Slack modal submission

When a workflow handles a Slack modal `view_submission` (triggered via `ctx.slack.openModal()` or `ctx.slack.updateModal()`):

```typescript
{
  type: "view_submission",                 // distinguishes from slash_command and block_actions
  triggerId: "1234567890.123456",          // trigger ID for opening follow-up modals
  formValues: {                            // nested view.state.values
    block_id: {
      action_id: { value: "user input", selected_option: { value: "opt1" } }
    }
  },
  metadata: "json-string-from-private_metadata",  // the private_metadata string from the modal
  viewId: "V0123456789",                   // for ctx.slack.updateModal() in multi-step flows
  userId: "U0123456789",                   // who submitted
}
```

- `formValues` mirrors Slack's `view.state.values` structure — nested by `block_id` then `action_id`
- `metadata` is the `private_metadata` string from the modal view — use it to stash context between modal steps
- `viewId` is needed for `ctx.slack.updateModal()` to push a new modal view in multi-step flows

#### `mug run` (CLI)

Currently empty (`{}`). Params from CLI are not yet supported — test handler workflows by submitting forms or triggering portal actions.

### ctx.isDemo

`true` when the workflow was triggered from a surface in demo mode (via `mug demo enable`).

```typescript
get isDemo(): boolean
```

Notifications are automatically routed during demo mode based on `--notify` mode and per-channel overrides — no manual guards needed for `ctx.notify.*`. Use `ctx.isDemo` to guard other side effects (destructive writes, external API calls):

```typescript
workflow("handle-request", async (ctx) => {
  // Notifications auto-routed by demo config
  await ctx.notify.sms({ to: manager.phone, message: "New request submitted" });

  // Guard non-notification side effects
  if (ctx.isDemo) return;
  await ctx.exec("UPDATE requests SET status = ? WHERE id = ?", ["submitted", ctx.params.id]);
});
```

**Demo surface IDs:** Any surface ID works with `mug demo enable`. Use `_home` as the surface ID to demo the workspace home screen.

### ctx.instanceId

Unique ID for the current workflow run. In production, the format is `workspace-timestamp-id`. In local dev, it's `local-{runId}`.

```typescript
get instanceId(): string | undefined
```

Use to correlate log entries, pass to external systems for tracking, or reference in `mug status`:

```typescript
await ctx.notify.email({
  to: admin,
  message: `Workflow started. Track: \`mug status ${workflowName} ${ctx.instanceId}\``,
});
```

### ctx.changesetId / ctx.changesetSource

Auto-set on every workflow run. `changesetId` is a unique ID for the run, `changesetSource` is `"workflow:<name>"`. Passed to `ctx.exec()` automatically for audit trail — every database write is tagged with which workflow made the change.

```typescript
get changesetId(): string | undefined
get changesetSource(): string | undefined
```

These are set automatically — you don't need to manage them. They're useful when querying the ops database to trace which workflow modified a record.

### ctx.steps

*Read-only.* Array of `StepRecord` objects for the current workflow run. Each `ctx.*` call appends a step with timing, input/output, and token usage. Primarily used internally for logging — visible in `mug logs` output. Not typically needed in user workflow code.

```typescript
get steps(): StepRecord[]
```

### ctx.credential(name?)

*Source context only.* Resolve an API credential from workspace secrets.

```typescript
async credential(name?: string): Promise<string>
```

**Resolution chain:**

1. Checks `mug.json` source `auth.value` for the source
2. If `auth.value` matches an environment variable name → returns that env var's value
3. If `auth.value` doesn't match an env var → returns it as a literal string
4. Falls back to the platform credential store (OAuth tokens from `mug auth`)

The `name` parameter defaults to the source name. Override it when a source needs a differently-named credential.

```typescript
// In a source — resolves via the source config
const token = await ctx.credential();

// Override credential name
const token = await ctx.credential("GITHUB_PAT");
```

**Wiring credentials:**
```bash
mug secret set AIRTABLE_API_KEY=pat_xxxxx     # store the credential
```

```json
// mug.json — reference the credential (not the value itself)
"sources": {
  "airtable": {
    "auth": { "type": "bearer", "value": "AIRTABLE_API_KEY" },
    "baseUrl": "https://api.airtable.com/v0",
    "syncs": { "airtable": { "database": "airtable", "schedule": "*/15 * * * *" } }
  }
}
```

Here `auth.value` is `"AIRTABLE_API_KEY"` — the runtime checks if an env var with that name exists (it does, from `.mug/secrets`), and returns its value.

**Throws:** `No credentials for "<source>"` when no credential can be resolved.

### ctx.secret(name)

*Workflow context.* Read a workspace secret by name. Secrets are stored in `.mug/secrets` via `mug secret set`.

```typescript
secret(name: string): string
```

Returns the secret value as a string. **Throws** if the secret is not found.

```typescript
// Read an API key stored in .mug/secrets
const apiKey = ctx.secret("EXTERNAL_API_KEY");

// Use it for outbound HTTP calls
const res = await fetch("https://api.example.com/data", {
  headers: { Authorization: `Bearer ${apiKey}` },
});
```

Unlike `ctx.credential()` (which is source-only and resolves through `mug.json` source config), `ctx.secret()` is a direct key-value lookup — any secret set via `mug secret set KEY=VALUE` is accessible by name. Use it when workflows need API keys, tokens, or other secrets that aren't tied to a source.

### ctx.slack.updateMessage(options)

Update an existing Slack message (e.g., replace action buttons with a result after a user clicks). Requires `SLACK_BOT_TOKEN` in secrets.

```typescript
async updateMessage(options: {
  channel: string;        // channel ID
  ts: string;             // message timestamp to update
  text?: string;          // new fallback text
  blocks?: unknown[];     // new Block Kit blocks
}): Promise<void>
```

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

**Throws:** `SLACK_BOT_TOKEN not configured`, Slack API errors.

### ctx.slack.openModal(options)

Open a Slack modal from a slash command or interaction. Requires a `triggerId` from the incoming event.

```typescript
async openModal(options: {
  triggerId: string;              // from ctx.params.triggerId (slash commands/interactions)
  view: Record<string, unknown>;  // Slack modal view payload
}): Promise<void>
```

```typescript
await ctx.slack.openModal({
  triggerId: ctx.params.triggerId,
  view: {
    type: "modal",
    title: { type: "plain_text", text: "Create Dispatch" },
    submit: { type: "plain_text", text: "Create" },
    blocks: [
      { type: "input", element: { type: "plain_text_input", action_id: "title" },
        label: { type: "plain_text", text: "Job Title" } },
    ],
  },
});
```

**Throws:** `SLACK_BOT_TOKEN not configured`, Slack API errors, expired trigger ID.

### ctx.slack.updateModal(options)

Update an open Slack modal — used for multi-step modal flows. The `viewId` comes from `ctx.params.viewId` in a `view_submission` handler.

```typescript
async updateModal(options: {
  viewId: string;                   // from ctx.params.viewId in view_submission
  view: Record<string, unknown>;    // updated Slack modal view payload
}): Promise<void>
```

```typescript
// Multi-step modal: after first submission, show a second page
if (ctx.params.type === "view_submission") {
  await ctx.slack.updateModal({
    viewId: ctx.params.viewId as string,
    view: {
      type: "modal",
      title: { type: "plain_text", text: "Step 2" },
      submit: { type: "plain_text", text: "Confirm" },
      private_metadata: JSON.stringify({ step: 2, data: ctx.params.formValues }),
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "Confirm your selections:" } },
      ],
    },
  });
}
```

**Throws:** `SLACK_BOT_TOKEN not configured`, Slack API errors.

### ctx.slackApiCall(method, body)

Call any Slack Web API method directly. Use for operations not covered by the higher-level helpers (reactions, pins, channel management, user lookups, etc.).

```typescript
async slackApiCall(
  method: string,                       // Slack API method (e.g., "reactions.add")
  body: Record<string, unknown>         // request body
): Promise<Record<string, unknown>>     // Slack API response
```

```typescript
await ctx.slackApiCall("reactions.add", {
  channel: "C0123456789",
  timestamp: "1234567890.123456",
  name: "white_check_mark",
});

const user = await ctx.slackApiCall("users.info", { user: "U0123456789" });
```

**Requires:** `SLACK_BOT_TOKEN` configured. **Throws:** on missing token or Slack API errors.

### ctx.agent(name, options)

Invoke a custom AI agent from a workflow. Agents run autonomous multi-step work with tools, memory, and structured output. See [agents.md](agents.md) for full agent config, memory, tool grants, and cap enforcement.

```typescript
async agent(
  name: string,
  options: {
    goal: string;                              // what the agent should accomplish
    context?: Record<string, unknown>;         // contextual data passed to the agent
    sessionKey?: string;                       // custom session key (default: runId-agentName)
    caps?: { maxTurns?: number; maxCredits?: number; maxDuration?: number };
  }
): Promise<{
  response: string;                            // agent's text response
  output?: Record<string, unknown>;            // structured output from deliver_output
  usage: { credits: number; turns: number; duration: number };
  capped?: boolean;                            // true if agent hit a cap
  cappedReason?: string;                       // "turn_limit" | "credit_limit" | "duration_limit"
  pendingApproval?: { tool: string; args: Record<string, unknown>; sessionKey: string };
}>
```

```typescript
const result = await ctx.agent("invoice-analyzer", {
  goal: "Review all invoices from the past week and flag overdue ones",
  context: { overdueThreshold: 30 },
  caps: { maxTurns: 20 },
});

if (result.pendingApproval) {
  // Agent paused for human approval — see agents.md for the full pattern
}
```

**Throws:** Agent not found, agent runtime errors.

### Agent Chat (Slack DMs)

Set `"chat": true` in `agent.json` to make an agent conversational via Slack DMs. When enabled:

- The Slack app's Messages Tab auto-enables (`messagesTab: true` in the manifest)
- DMs to the bot route to the chat-enabled agent
- Each user gets a persistent Think DO session — the agent remembers context across messages
- Session key format: `chat:{agentName}:{slackUserId}`

No workflow needed — the platform handles message routing and response posting. The agent's SOUL.md and skills define how it responds.

### Agent Email

Create `email.json` in the agent's folder to give it an email address. See the agents SKILL.md for the full schema.

Flow: inbound email → deterministic filter (zero AI cost) → agent classifies against categories → acts → optionally replies.

- Email address format: `{address}@{workspace-domain}` (e.g., `dispatch@acme.mug.work`)
- Thread context: prior exchanges from the same thread (via In-Reply-To) are injected into the agent's context
- Each email session is logged to the ops logger as `email:{agentName}`
- The agent can trigger workflows via `trigger_workflow` for complex multi-step processing

### ctx.action(connectorName)

Perform outbound operations against external systems through connectors. **Workflow-only** — not available in agents or connectors.

Returns a `ConnectorHandle` with typed methods:

```typescript
ctx.action(connectorName: string): ConnectorHandle

// ConnectorHandle methods:
.read(table: string, recordId: string): Promise<ActionResult>
.create(table: string, fields: Record<string, unknown>): Promise<ActionResult>
.update(table: string, recordId: string, fields: Record<string, unknown>): Promise<ActionResult>
.delete(table: string, recordId: string): Promise<ActionResult>
.upsert(table: string, recordId: string, fields: Record<string, unknown>): Promise<ActionResult>

interface ActionResult<T = Record<string, unknown>> {
  connector: string;      // connector name
  table: string;          // table name
  operation: ActionType;  // "read" | "create" | "update" | "delete" | "upsert"
  recordId?: string;      // external record identifier
  data: T;                // response from the external API
  snapshot?: Record<string, unknown>;  // pre-mutation state (transforms only)
  operationId: string;    // unique ID for this action in the ops log
}
```

```typescript
// Read a single record
const invoice = await ctx.action("quickbooks").read("invoices", "inv-123");

// Update a record (auto-snapshots current state before writing)
const result = await ctx.action("quickbooks").update("invoices", "inv-123", {
  status: "paid",
  paid_date: new Date().toISOString(),
});
// result.snapshot contains the record before the update — used for rollback

// Create a new record
const created = await ctx.action("hubspot").create("contacts", {
  name: "Jane Smith",
  email: "jane@example.com",
});
```

**Safety guarantees:**
- All transform operations (create/update/delete/upsert) auto-call `get()` before writing, storing the full before-snapshot for rollback
- Every action is logged in `_mug_ops.actions` with full audit trail
- Default max 100 operations per workflow run (configurable via `maxOperations`)
- Agents cannot call `ctx.action()` directly — they must trigger a workflow

**Throws:** Connector not found, table not found, action method not defined, max operations exceeded, API errors.

### ctx.rollback(actionId)

Undo a prior action using its stored before-snapshot. The inverse operation executes through `ctx.action()` — it gets its own audit log entry, own before-snapshot, and counts against the ops cap.

```typescript
async rollback(actionId: string): Promise<ActionResult>
```

Inverse mapping: `create` → `delete`, `update` → `update` (with snapshot), `delete` → `create` (from snapshot), `upsert` → conditional.

**Throws:** Action not found, already rolled back, read actions, missing snapshot.

### ctx.rollbackRun(workflowRunId)

Roll back all transform actions from a workflow run in reverse chronological order.

```typescript
async rollbackRun(workflowRunId: string): Promise<{
  rolledBack: ActionResult[];
  failed: { actionId: string; error: string }[];
}>
```

### ctx.lastSync

*Source context only.* ISO 8601 timestamp of the last successful sync, or `null` on first sync. Use for incremental sync logic.

```typescript
lastSync: string | null
```

## Data Patterns

### Soft deletes

Synced tables (from sources) include system columns:

| Column | Purpose |
|--------|---------|
| `_mug_synced_at` | ISO timestamp of last sync that touched this row |
| `_mug_deleted_at` | ISO timestamp when row was marked deleted (null if active) |

**Always filter deleted rows when querying synced data:**

```typescript
// Good — excludes deleted records
const contacts = await ctx.query("SELECT * FROM contacts WHERE _mug_deleted_at IS NULL");

// Bad — includes records that were deleted in the source system
const contacts = await ctx.query("SELECT * FROM contacts");
```

This applies everywhere: workflows, portal queries, and any SQL against synced tables. Workflow-created tables (via `ctx.exec`) do not have system columns.

### Unified workspace database

All connector data lives in a single workspace database with prefixed table names (`{source}_{table}`). Cross-source JOINs are plain SQL:

```typescript
// Cross-source JOIN — correlate QuickBooks invoices with HubSpot contacts
const enriched = await ctx.query(
  `SELECT i.*, c.name, c.email
   FROM quickbooks_invoices i
   JOIN hubspot_contacts c ON i.customer_id = c.id
   WHERE i.status = 'overdue' AND c._mug_deleted_at IS NULL`
);
```

**Table name resolution:** when a table name is unique across all sources, use it without the prefix. If ambiguous (same name in multiple sources), you'll get a clear error listing the prefixed options.

```typescript
// "properties" only exists in airtable — auto-resolved to airtable_properties
const props = await ctx.query("SELECT * FROM properties WHERE status = 'active'");

// "contacts" in both airtable and hubspot — must use prefix
const contacts = await ctx.query("SELECT * FROM hubspot_contacts WHERE _mug_deleted_at IS NULL");
```

- **Locally**, each source has its own `databases/<source>.db` file. `mug sql <source> <sql>` queries these directly (no prefix needed). The dev server merges them into a unified DO with prefixes.
- **Tables you create** via `ctx.exec()` go in the `mug_` namespace (e.g., `ctx.exec("CREATE TABLE alerts ...")` creates `mug_alerts`).
- **Source isolation**: large sources can be kept in their own DO with `"isolated": true` in the source config. Isolated sources cannot participate in cross-source JOINs.
- **The ops database** (`_mug_ops`) is implicit — contains `workflow_runs` and `workflow_steps` tables.

### Ops database

Workflow runs are automatically persisted to the `_mug_ops` database.

**workflow_runs:**

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Run ID (`<name>-<timestamp>-<random>`) |
| workflow | TEXT | Workflow name |
| status | TEXT | `"complete"` or `"errored"` |
| started_at | TEXT | ISO 8601 |
| completed_at | TEXT | ISO 8601 |
| duration_ms | INTEGER | Total duration |
| params | TEXT | JSON input params |
| result | TEXT | JSON return value |
| error | TEXT | Error message |

**workflow_steps:**

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| run_id | TEXT FK | References workflow_runs.id |
| step_name | TEXT | Step identifier (e.g., `query-hubspot-1`) |
| step_type | TEXT | `query`, `exec`, `ai`, `notify`, `collect` |
| started_at | TEXT | ISO 8601 |
| completed_at | TEXT | ISO 8601 |
| duration_ms | INTEGER | Step duration |
| input | TEXT | JSON (truncated to 4096 chars) |
| output | TEXT | JSON (truncated to 4096 chars) |
| error | TEXT | Error message |
| tokens_used | INTEGER | AI token count |
| retries | INTEGER | Retry count (default 0) |

**actions:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Unique operation ID |
| `workflow_run_id` | TEXT NOT NULL | Parent workflow run |
| `step_id` | TEXT | Workflow step that triggered this |
| `connector` | TEXT NOT NULL | Connector name |
| `table_name` | TEXT NOT NULL | Table within connector |
| `operation` | TEXT NOT NULL | read, create, update, delete, upsert |
| `record_id` | TEXT | External record identifier |
| `before_snapshot` | TEXT | Full JSON of record pre-mutation (NULL for reads/creates) |
| `after_payload` | TEXT | JSON of what was sent to external API |
| `after_confirmed` | TEXT | JSON of what the API returned |
| `rolled_back` | INTEGER DEFAULT 0 | 1 if this action has been undone |
| `rolled_back_at` | TEXT | ISO 8601 timestamp of rollback |
| `rollback_action_id` | TEXT | ID of the action that performed the rollback |
| `created_at` | TEXT NOT NULL | ISO 8601 timestamp |

Indexes: `idx_actions_workflow` (workflow_run_id), `idx_actions_connector` (connector, table_name), `idx_actions_operation` (operation).

```sql
-- Recent actions for a connector
SELECT id, operation, record_id, created_at FROM actions WHERE connector = 'airtable' ORDER BY created_at DESC LIMIT 20;

-- All actions from a workflow run
SELECT * FROM actions WHERE workflow_run_id = ? ORDER BY created_at;

-- Rolled-back actions
SELECT id, operation, record_id, rolled_back_at FROM actions WHERE rolled_back = 1;
```

### GET /actions

Query the action audit log from the dev server.

Query parameters:
- `limit` — max results (default 50)
- `connector` — filter by connector name
- `operation` — filter by operation type (read/create/update/delete/upsert)
- `run` — filter by workflow run ID

```bash
curl http://localhost:8787/actions?connector=airtable&limit=10
```

### The `:user` and `:auth.column` parameters (portals and forms)

In portal SQL queries, `:user` is a parameterized value bound to the current session's verified identity (email or phone).

```sql
SELECT * FROM requests WHERE employee_email = :user ORDER BY created_at DESC
```

- Bound as a parameterized query value — SQL-injection safe
- Resolves to the session's verified email or phone
- In dev mode, resolves to the "View As" banner identity
- **With `access: { mode: "public" }`**: resolves to empty string — queries filtering on `:user` will return zero rows. Only use `:user` with `identify` or `auth` access modes.

With `auth` access mode, `:auth.column` references any column from the user's auth table row:

```sql
SELECT * FROM requests WHERE department = :auth.department ORDER BY created_at DESC
SELECT * FROM tasks WHERE assignee_id = :auth.id AND status = 'active'
```

- Requires `auth` access mode — the runtime fetches `SELECT *` from the auth table at render time
- Any column name from the auth table works: `:auth.id`, `:auth.name`, `:auth.department`, `:auth.role`
- SQL-injection safe (parameterized)
- Combine with `:user`: `WHERE email = :user AND department = :auth.department`

## Error Handling

All `ctx.*` methods throw standard JavaScript `Error` objects on failure. Workflows that don't catch errors will terminate with `status: "errored"` and the error message is recorded in `mug logs`.

```typescript
workflow("safe-notify", async (ctx) => {
  const overdue = await ctx.query("SELECT * FROM invoices WHERE status = 'overdue' AND _mug_deleted_at IS NULL");

  for (const inv of overdue) {
    try {
      await ctx.notify.sms({
        to: inv.phone as string,
        message: `Invoice #${inv.number} is overdue.`,
      });
    } catch (e) {
      // Log failure but continue processing other invoices
      await ctx.exec("INSERT INTO notification_failures (invoice_id, error, ts) VALUES (?, ?, ?)",
        [inv.id as string, (e as Error).message, new Date().toISOString()]);
    }
  }
});
```

### Common errors

| Error | Cause | Fix |
|-------|-------|-----|
| `no such table: <name>` | Table doesn't exist in the database | Run the source sync first, or create the table with `ctx.exec()` |
| `AI not configured: missing ANTHROPIC_API_KEY` | No API key in dev | `mug secret set ANTHROPIC_API_KEY=sk-ant-...` |
| `AI request failed (429)` | Rate limit hit | Reduce concurrency or add delays between AI calls |
| `AI credit limit exceeded` | AI credits at 0 remaining | Enable overages at mug.work, `mug workspace plan`, or switch to BYOK (`billing: "ai.anthropic"`) — see [billing.md](billing.md) |
| `Usage limit exceeded for email` | Email send limit reached | Enable overages at mug.work or `mug workspace plan` — catch in workflow to handle gracefully |
| `Usage limit exceeded for sms` | SMS send limit reached | Enable overages at mug.work or `mug workspace plan` |
| `No credentials for "<source>"` | Credential not found | Check `mug secret set` and `mug.json` source config — see [ctx.credential](#ctxcredentialname) |
| `Workflow "<name>" not found` | Workflow file not in `workflows/` directory | Ensure the file exists at `workflows/<name>.ts` and uses `workflow("<name>", ...)` to register |

### Production durability

In production, workflows run as Cloudflare Workflows with durable execution. Each `ctx.*` call becomes a durable step — if the Worker restarts mid-execution, the workflow resumes from the last completed step automatically. AI calls in production include automatic retry (2 retries, exponential backoff).

## Webhook-Triggered Workflows

Workflows can be triggered by external webhooks. Configure in the workflow options:

```typescript
// No auth (public endpoint)
workflow("process-event", async (ctx) => { ... }, {
  webhook: true,
});

// HMAC signature verification
workflow("stripe-handler", async (ctx) => { ... }, {
  webhook: { auth: "hmac", secret: "STRIPE_WEBHOOK_SECRET" },
});

// Bearer token
workflow("partner-sync", async (ctx) => { ... }, {
  webhook: { auth: "bearer", secret: "PARTNER_API_TOKEN" },
});
```

The `secret` value references a key in `.mug/secrets` (same as source credentials).

### Webhook URL

After `mug deploy`, the webhook URL is:
```
POST https://api.mug.work/hook/<workspace>/<workflow-name>
```

During local dev with `mug dev --tunnel`:
```
POST https://<tunnel-url>/hook/<workflow-name>
```

### Handling webhook payloads

The POST body arrives as `ctx.params`:

```typescript
workflow("process-event", async (ctx) => {
  const { event_type, data } = ctx.params;
  // Process the webhook payload
});
```

### Controlling the webhook response

By default, webhooks return `{ ok: true }` immediately. Use `ctx.respond()` to send a custom response (e.g., for Slack URL verification):

```typescript
workflow("slack-events", async (ctx) => {
  if (ctx.params.type === "url_verification") {
    ctx.respond({ challenge: ctx.params.challenge });
    return;
  }
  // Process the event
}, { webhook: true });
```

## Inbound Message Routing

Receive inbound SMS replies, email replies, and Slack interactions as workflow triggers. Configure in the workflow options:

```typescript
workflow("handle-sms-reply", async (ctx) => { ... }, {
  inbound: "sms",
});

workflow("handle-email-reply", async (ctx) => { ... }, {
  inbound: "email",
});

workflow("handle-slack-action", async (ctx) => { ... }, {
  inbound: "slack",
});
```

After `mug deploy`, webhook URLs are displayed:
- SMS: `https://api.mug.work/inbound/sms/<workspace>` (set as your Twilio webhook URL)
- Email: `https://api.mug.work/inbound/email/<workspace>` (set as Resend inbound webhook)
- Slack: `https://api.mug.work/inbound/slack/<workspace>` (set as Slack request URL)

**Inbound SMS requires BYOK.** Mug's platform number is outbound-only. To receive inbound SMS, bring your own Twilio number and point its webhook to `https://api.mug.work/inbound/sms/<workspace>`.

### Inbound SMS

Workflow receives webhook data as params (normalized across providers):

```typescript
workflow("handle-sms-reply", async (ctx) => {
  const { from, body } = ctx.params as { from: string; body: string };
  const [contact] = await ctx.query("SELECT * FROM contacts WHERE phone = ?", [from]);
  if (!contact?.pending_action) return;

  if (contact.pending_action === "expense-approval" && body.trim().toUpperCase() === "YES") {
    const data = JSON.parse(contact.pending_data as string);
    await ctx.exec("UPDATE expenses SET status = 'approved' WHERE id = ?", [data.expenseId]);
    await ctx.notify.sms({ to: from, message: "Approved. Thanks!" });
  }
  await ctx.exec("UPDATE contacts SET pending_action = NULL WHERE id = ?", [contact.id]);
});
```

### Inbound Email

```typescript
workflow("handle-email-reply", async (ctx) => {
  const { from, subject, body } = ctx.params as { from: string; subject: string; body: string };
  // Route based on subject line, sender lookup, or pending_action field
});
```

### Inbound Slack

```typescript
workflow("handle-slack-action", async (ctx) => {
  const { userId, actionId, actionValue } = ctx.params as { userId: string; actionId: string; actionValue: string };
  // Handle button clicks, modal submissions, etc.
});
```

### "Send and wait for reply" pattern

Use two workflows — one sends + flags the contact, the other catches the reply + checks the flag:

```typescript
// Workflow 1: Send and flag
workflow("request-approval", async (ctx) => {
  const { contactId, amount } = ctx.params;
  const [contact] = await ctx.query("SELECT phone FROM contacts WHERE id = ?", [contactId]);
  await ctx.notify.sms({ to: contact.phone, message: `Approve $${amount}? Reply YES or NO` });
  await ctx.exec(    "UPDATE contacts SET pending_action = 'expense-approval', pending_data = ? WHERE id = ?",
    [JSON.stringify({ amount, contactId }), contactId]);
});

// Workflow 2: Catch reply
workflow("handle-sms-reply", async (ctx) => {
  const { from, body } = ctx.params as { from: string; body: string };
  const [contact] = await ctx.query("SELECT * FROM contacts WHERE phone = ?", [from]);
  if (!contact?.pending_action) return;
  // ... check pending_action, take action, clear flag
});
```

The database is the correlation store — inspectable, debuggable, and under your control.

## Scheduling

Add a `schedule` to workflow options. Use a cron string for simple patterns or a structured `ScheduleConfig` object for complex ones:

```typescript
// Cron string — simple
workflow("daily-report", handler, { schedule: "0 9 * * 1-5" });

// ScheduleConfig — 3rd Tuesday at 9am, skip holidays
workflow("board-prep", handler, {
  schedule: { weekday: "tuesday", nth: 3, time: "09:00", skipHolidays: true },
});

// ScheduleConfig — every 15 min from 2-4pm on Wednesdays
workflow("slot-check", handler, {
  schedule: { interval: "15m", between: ["14:00", "16:00"], weekday: "wednesday" },
});

// ScheduleConfig — last Friday of the month
workflow("monthly-close", handler, {
  schedule: { weekday: "friday", nth: -1, time: "17:00" },
});
```

Source sync schedules use cron strings in the `source()` definition: `source({ syncSchedule: "*/15 * * * *", ... })`.

### ScheduleConfig fields

| Field | Type | Description |
|-------|------|-------------|
| `weekday` | `"monday"` .. `"sunday"` | Day of week |
| `nth` | `1-5` or `-1` | Nth weekday in month (-1 = last) |
| `time` | `"HH:MM"` | Time in 24h format |
| `interval` | `"15m"`, `"1h"`, `"6h"` | Repeat interval |
| `between` | `["14:00", "16:00"]` | Time window for interval |
| `skipHolidays` | `true` or `"US"` | Skip workspace holidays (true) or a specific country |
| `skipDates` | `["2026-12-24"]` | Skip specific dates |
| `cron` | `"0 9 1 * *"` | Base cron pattern (combine with modifiers like skipHolidays) |
| `timezone` | `"America/New_York"` | IANA timezone |

### Common cron expressions

| Expression | Meaning | Min tier |
|-----------|---------|----------|
| `*/5 * * * *` | Every 5 minutes | Pro |
| `*/15 * * * *` | Every 15 minutes | Starter |
| `0 * * * *` | Every hour | Free |
| `0 9 * * 1-5` | Weekdays at 9am UTC | Free |
| `0 0 * * *` | Daily at midnight UTC | Free |
| `0 9 * * 1` | Mondays at 9am UTC | Free |
| `0 */6 * * *` | Every 6 hours | Free |

**Minimum interval per tier:** Schedules faster than the tier floor are silently clamped on deploy. Free = daily, Starter = 15min, Pro = 5min, Business = 1min. See [billing.md](billing.md) for details. Cron schedules run in **UTC**.

### Holiday calendar

Configure workspace holidays in `mug.json` to enable `skipHolidays` in schedules:

```json
{
  "holidays": {
    "country": "US",
    "include": [
      "christmas-eve",
      "black-friday",
      "easter-monday",
      { "name": "Company Retreat", "rule": "3rd wednesday of september" },
      { "name": "Founder's Day", "date": "2026-08-15" }
    ],
    "exclude": ["columbus-day-indigenous-peoples-day"]
  }
}
```

Public holidays are fetched from Nager.Date for the configured country on each deploy. Built-in computed extras: `christmas-eve`, `black-friday`, `easter-monday`. Custom rules use "Nth weekday of month" patterns. Exclude holidays by slug.

## mug.json Config Reference

```json
{
  "name": "my-workspace",
  "id": "workspace-id-from-platform",
  "plan": "starter",
  "subdomain": "custom-subdomain",
  "settings": {
    "timezone": "America/Denver"
  },
  "sources": {
    "<name>": {
      "auth": {
        "type": "bearer | api-key | basic | oauth2",
        "value": "<credential-or-env-var-name>",
        "header": "<header-name>"
      },
      "baseUrl": "<API root URL>",
      "syncs": {
        "<sync-name>": { "database": "<db-name>", "schedule": "<cron expression>" }
      }
    }
  },
  "databases": {
    "<name>": {
      "tables": {}
    }
  },
  "workflows": {
    "<name>": {
      "schedule": "<cron expression>",
      "file": "workflows/<name>.ts",
      "webhook": "(deprecated — use workflow options instead)",
      "trigger": "{ type: 'slack_command' | 'slack_event' | 'slack_shortcut' | 'data', command?, event?, description?, source?, table?, on?, includeInitialSync? }"
    }
  },
  "inbound": "(deprecated — use workflow options instead)",
  "ai": {
    "routing": {
      "fast": "openai/gpt-5.4-nano",
      "balanced": "@cf/moonshotai/kimi-k2.6",
      "powerful": "anthropic/claude-sonnet-4-6"
    },
    "billing": {
      "default": "mug-metered",
      "fast": "mug-metered",
      "balanced": "mug-metered",
      "powerful": "ai.anthropic"
    }
  },
  "surfaces": {},
  "branding": {
    "logo": "assets/logo.png",
    "logoSquare": "assets/icon.png",
    "accentColor": "#1a5276",
    "ogImage": "assets/og-image.png"
  },
  "holidays": {
    "country": "US",
    "include": ["christmas-eve", "black-friday", "easter-monday"],
    "exclude": []
  },
  "dev": {
    "email": "developer@example.com"
  }
}
```

### settings

- `timezone` — IANA timezone (e.g., `"America/Denver"`). Auto-detected at `mug init`. Controls how `date` and `datetime` values display in surfaces. Can be overridden per-surface by adding `"timezone"` to the surface JSON.

### sources

External API connections and their sync config. **Credentials are not stored here** — `auth.value` references an env var name from `.mug/secrets` or a literal token. Source code lives in `connectors/<name>.ts`.

- `auth.type: "bearer"` — sends `Authorization: Bearer <token>`
- `auth.type: "api-key"` — sends credential in a custom header (specify `header` field)
- `auth.type: "basic"` — sends `Authorization: Basic <base64>`
- `auth.type: "oauth2"` — managed by `mug auth <provider>`, tokens refreshed automatically
- `syncs` — maps sync names to `{ database, schedule }` pairs

### databases

Explicit database registration. Sources auto-register their databases here. Workflow-created databases don't need registration — they're created on first access.

### workflows

**Deprecated** — move schedule, webhook, and trigger config to workflow TypeScript options: `workflow("name", handler, { schedule: "0 9 * * 1-5", webhook: { auth: "hmac", secret: "KEY" } })`. The `workflows` section in mug.json is a legacy fallback — TypeScript source is the canonical location.

### holidays

Holiday calendar configuration for `skipHolidays` in workflow schedules. Public holidays are fetched from Nager.Date on deploy.

- `country` — ISO country code (e.g., `"US"`, `"GB"`, `"CA"`). Default: `"US"`.
- `include` — additional holidays to add. Built-in slugs: `"christmas-eve"`, `"black-friday"`, `"easter-monday"`. Custom rules: `{ "name": "...", "rule": "3rd wednesday of september" }` or `{ "name": "...", "date": "2026-08-15" }`.
- `exclude` — holiday slugs to remove (e.g., `"columbus-day-indigenous-peoples-day"`).

### inbound

**Deprecated** — move to workflow options: `workflow("name", handler, { inbound: "sms" })`

Maps inbound message channels to handler workflows. After `mug deploy`, webhook URLs are displayed for each configured channel.

### slack

Slack app configuration. Managed by `/slack` skill and `mug deploy`. See the Slack skill for guided setup.

- `enabled` — `true` to deploy a Slack app for this workspace
- `name` — app display name in Slack
- `description` — app description
- `color` — hex brand color for the app
- `scopes` — OAuth scopes (e.g., `["chat:write", "commands"]`)
- `eventSubscriptions` — events to listen for (e.g., `["message.app_mention"]`)
- `interactivityEnabled` — enable interactive components (buttons, modals)

### ai

AI model routing and billing configuration. See [ai.md](ai.md) for the full reference.

- `routing` — maps tiers to provider/model. Keys: `fast`, `balanced`, `powerful`. Values: `"provider/model"` format (e.g., `"openai/gpt-5.4-nano"`, `"@cf/moonshotai/kimi-k2.6"`). Platform defaults used if not set.
- `billing` — maps tiers to billing method. Keys: `default`, `fast`, `balanced`, `powerful`. Values: `"mug-metered"` (Mug credits) or a BYOK key name from `mug secret set` (e.g., `"ai.anthropic"`).

### branding

- `logo` — rectangle logo for headers (relative path or URL). Uploaded to R2 on deploy.
- `logoSquare` — square logo variant for compact layouts. Falls back to `logo` if not set.
- `accentColor` — hex color applied to buttons, links, focus rings, progress bars via CSS `--accent`. Also tints the browser favicon.
- `ogImage` — custom 1200x630 PNG for link previews (Slack, iMessage, LinkedIn, Discord). Uploaded to R2 on deploy, served at `/_og-image.png`. Falls back to Mug default if not set.

Branding is applied automatically to forms, portals, home screen, and emails. All surfaces emit Open Graph and Twitter Card meta tags (og:title, og:description, og:image, twitter:card) for link previews. In dev, changes to branding hot-reload.

### plan

Workspace billing tier. Managed by `mug workspace plan` (interactive — opens Stripe Checkout for paid tiers). Values: `"free"`, `"starter"`, `"pro"`, `"business"`. Do not edit manually. See [billing.md](billing.md) for tier limits, overages, and schedule enforcement.

### subdomain

Optional custom subdomain for the workspace's production URL. Defaults to `name` if not set. The production URL becomes `https://<subdomain>.mug.work/`.

### dev

Development overrides. Auto-managed — `mug init`, `mug create`, `mug update`, and `mug dev` set `dev.email` to the logged-in user's email.

- `email` — redirect all dev email notifications to this address instead of real recipients. Subject is prefixed with original recipient: `[DEV → manager@company.com] ...`

## Home Screen (`surfaces/_home.json`)

The workspace root URL (`subdomain.mug.work/`) shows a branded auth screen, then a surface directory after login. Auth is configless — scans workspace owner/admin and all surface auth tables. No setup needed.

To customize the layout, create `surfaces/_home.json`:

```json
{
  "title": "Narvick Construction",
  "description": "Employee portal for time-off requests, job dispatch, and more",
  "groups": [
    {
      "label": "HR",
      "description": "Time off, benefits, and employee info",
      "color": "#2563eb",
      "buttons": [
        { "surface": "time-off-request", "label": "Request Time Off", "color": "#16a34a" }
      ],
      "cards": [
        { "surface": "portal", "label": "Employee Dashboard", "description": "View your requests and approvals", "color": "#f59e0b" }
      ]
    },
    {
      "label": "Operations",
      "buttons": [{ "surface": "dispatch-form" }],
      "cards": [{ "surface": "dispatch-portal", "label": "Job Board" }]
    }
  ]
}
```

**Top-level fields:**
- `title` — optional display name. Rendered as an `<h1>` heading in the header, used in `<title>` and OG meta. Falls back to title-cased workspace slug (e.g., `narvick-construction` → "Narvick Construction").
- `description` — optional description. Rendered below the title in the header, and used in OG/Twitter meta tags for link previews.

**Group fields:**
- `label` — optional group heading. Omit for a section without a header.
- `description` — optional subtitle below the group heading.
- `color` — optional hex color. Tints the group container border and gives it a subtle background fill.
- `buttons` — action surfaces (compact, horizontal row). Good for forms.
- `cards` — destination surfaces (larger, stacked). Good for portals.

**Surface item fields** (in both `buttons` and `cards`):
- `surface` — **(required)** surface ID matching a file in `surfaces/`.
- `label` — optional override. Falls back to the surface's `title` field.
- `color` — optional hex color. Buttons get a colored background. Cards get a colored top border.
- `description` — *(cards only)* optional context line below the title.

Both `buttons` and `cards` are optional per group. Surfaces not listed in any group appear at the bottom as default cards. No `_home.json` = all surfaces shown alphabetically as cards.

Deployed to R2 on `mug deploy`. In dev, `localhost:8787/` reads from `surfaces/_home.json` — changes hot-reload like any other surface.

## Workspace Files and Databases

Two top-level directories manage workspace data. A unified manifest at `.mug/manifest.json` tracks what exists in production — deployed source definitions, uploaded files, and database schemas.

### files/

Static files synced to R2 — assets, templates, CSVs, images. Drop a file here and run `mug push` to upload it to production. Workflows access files at runtime via `ctx.file()` / `ctx.fileText()`.

### databases/

Local SQLite files synced to production Durable Objects. `.db` files are gitignored — the manifest tracks what exists in production including full table schemas.

The optional `databases/databases.json` file provides descriptions for databases (tracked in git):

```json
{
  "platform": { "description": "Platform workspace and workflow data" },
  "crm": { "description": "Customer data synced from HubSpot" }
}
```

Descriptions appear in `mug databases`, the workspace explorer, and the CLI landing screen.

### .mug/manifest.json

The unified manifest tracks production state for all workspace artifacts — deployed source files, uploaded files, and database schemas:

```json
{
  "synced_at": "2026-05-14T10:30:00",
  "definitions": {
    "workflows/daily-report.ts": { "sha256": "a1b2c3...", "deployed_at": "2026-05-14T09:00:00" },
    "connectors/hubspot.ts": { "sha256": "d4e5f6...", "deployed_at": "2026-05-14T09:00:00" }
  },
  "files": {
    "logo.png": { "size": 24580, "sha256": "a1b2c3...", "updated_at": "2026-05-13T08:00:00" }
  },
  "databases": {
    "crm": {
      "size_mb": 12.4,
      "tables": {
        "contacts": {
          "columns": [{ "name": "id", "type": "INTEGER" }, { "name": "email", "type": "TEXT" }],
          "row_count": 3420
        }
      },
      "updated_at": "2026-05-14T09:00:00"
    }
  },
  "sources": ["workflows/daily-report.ts", "connectors/hubspot.ts"]
}
```

The `definitions` section enables drift detection — `mug status` compares local file sha256 hashes against deployed hashes to show which files have been modified since the last deploy.

### Sync behavior

- `mug deploy` archives source files (connectors, workflows, surfaces, agents, config) to R2 alongside the bundle
- `mug push` uploads local files/databases to production; `mug pull` downloads remote files/databases and source files
- `mug dev` and `mug update` repair missing directories and manifests automatically
- Files in the manifest but not present locally are remote-only — accessible via `ctx.file()` at runtime
- `.mug/manifest.json` is tracked in git so all collaborators see what exists in production
- `mug deploy --dry-run` shows what would change without deploying

## CLI Quick Reference

### Workspace setup

| Command | Description |
|---------|-------------|
| `mug init [name]` | Create a new workspace. Auto-registers with platform and reserves subdomain if logged in. |
| `mug clone [name]` | Clone an existing workspace from Mug cloud. Pulls source files (connectors, workflows, surfaces, agents) automatically. Files and databases stay remote until `mug pull --all`. |
| `mug start` | Get started — orientation for new workspaces, progress checklist for existing ones |
| `mug update` | Regenerate platform files (CLAUDE.md, skills, docs). Warns if CLI is outdated. Updates instruction files, skills, and docs only — your code in `connectors/`, `workflows/`, `agents/` is safe. Framework types come from the `@mugwork/mug` package. |
| `mug login` | Authenticate via email verification — interactive prompts, or `mug login <email>` to send code and `mug login <email> --code <c>` to verify. Creates account on first use. |
| `mug whoami` | Show account email and current workspace |
| `mug workspaces` | List all workspaces — cloud account and local machine, with paths and roles |
| `mug create workspace <name>` | Register workspace on the platform |

### Workspace Inspection

| Command | Description |
|---------|-------------|
| `mug sources` | List sync sources with descriptions |
| `mug databases` | List databases with sizes and descriptions (from `databases/databases.json`) |
| `mug workflows` | List workflows with descriptions |
| `mug agents` | List agents with descriptions or model |
| `mug surfaces` | List surfaces with type and description |
| `mug files` | List files with sizes |

### Development

| Command | Description |
|---------|-------------|
| `mug dev` | Start local dev server (auto-detects ports from 8787, hot reload, WebSocket) |
| `mug dev --port <port>` | Pin to a specific port |
| `mug dev --tunnel` | Expose via Cloudflare Quick Tunnel (requires `cloudflared`) |
| `mug shutdown` | Gracefully stop the running dev server (writes back databases) |
| `mug run <workflow>` | Execute workflow (auto-routes: dev server → production if deployed) |
| `mug run <workflow> --cloud` | Run in production (alias: `--production`) |
| `mug run <workflow> --local` | Force local dev server execution |
| `mug run <workflow> --port <n>` | Override dev server port |
| `mug invoke <name> "<goal>"` | One-shot agent invocation (auto-routes: dev server → production) |
| `mug invoke <name> "<goal>" --cloud` | Invoke in production (deployed agent) |
| `mug invoke <name> "<goal>" --local` | Force local dev server |
| `mug chat <name>` | Start interactive chat session with an agent |
| `mug status` | Workspace drift summary + schedule health |
| `mug status <workflow> <instanceId>` | Check production workflow instance status |
| `mug logs [workflow]` | View execution history (defaults to cloud if deployed) |
| `mug logs [workflow] --cloud` | Force production logs (alias: `--production`) |
| `mug logs [workflow] --local` | Force local dev server logs |
| `mug logs <workflow> --limit <n>` | Show more entries (default: 10) |
| `mug logs <workflow> --json` | JSON output |
| `mug sql <database> <sql>` | Run SQL against `databases/<database>.db` (no dev server needed) |
| `mug sql <database> <sql> --json` | JSON output |
| `mug sql <database> <sql> --production` | Run SQL against production database |
| `mug sql <database> <sql> --dev` | Route through dev server instead of local file |
| `mug push databases/<name>` | Upload local database to production |
| `mug push files/<path>` | Upload a specific file to production |
| `mug push --all` | Upload all local files and databases |
| `mug push --all --force` | Push all without confirmation prompt |
| `mug push --json` | JSON output (uploaded/errors arrays) |
| `mug pull databases/<name>` | Download production database locally |
| `mug pull files/<path>` | Download a specific file from production |
| `mug pull --all` | Download all remote source files, user files, and databases |
| `mug usage` | Show usage across all 6 billing dimensions (--json, --period YYYY-MM) |
| `mug usage --json` | JSON output |

### Connectors

| Command | Description |
|---------|-------------|
| `mug connector discover <product>` | Record API availability (tier, auth, docs URL, spec URL) |
| `mug connector gather --slug <name>` | Produce OpenAPI spec (`--from-spec`, `--from-file`, `--from-har`) |
| `mug connector verify --slug <name> --source <name>` | Run 7-probe live API verification |
| `mug connector scaffold --slug <name>` | Generate TypeScript source from enriched spec |
| `mug connector init <product>` | Full pipeline: discover → gather → verify → scaffold |
| `mug connector search <query>` | Search community connector catalog |
| `mug connector clone --slug <name>` | Clone connector from catalog (spec + scaffold) |

### Forms

| Command | Description |
|---------|-------------|
| `mug form init <name>` | Scaffold form + handler workflows |
| `mug form validate [name]` | Validate form schemas |
| `mug form list` | List forms and URLs |

### Portals

| Command | Description |
|---------|-------------|
| `mug portal init <name>` | Scaffold portal config |
| `mug portal list` | List portals and URLs |

### Secrets

| Command | Description |
|---------|-------------|
| `mug secret set <KEY=VALUE>` | Store secret in `.mug/secrets` (gitignored) |
| `mug secret set <KEY=VALUE> --production` | Sync secret to production |
| `mug secret list` | Show stored secret keys (not values) |
| `mug secret remove <KEY>` | Remove a secret from `.mug/secrets` |

### Auth

| Command | Description |
|---------|-------------|
| `mug auth <provider>` | Connect provider via OAuth (opens browser). Supported providers depend on platform configuration. |

### Workspace management

| Command | Description |
|---------|-------------|
| `mug workspace status` | Show workspace metadata, URL, plan tier, last deploy |
| `mug workspace plan` | View or change plan tier (opens Stripe Checkout for paid tiers) |
| `mug billing` | View plan, price, next invoice, per-meter overage settings (`--overage`, `--cap`, `--notify-email`, `--json`) |
| `mug workspace invite <email>` | Send admin invite to workspace |
| `mug workspace transfer <email>` | Transfer ownership (sends invite, transfers when accepted) |
| `mug workspace remove <email>` | Remove member |
| `mug workspace members` | List members + pending invites |
| `mug workspace cancel-invite <id>` | Cancel a pending invite you sent |
| `mug workspace check-subdomain <slug>` | Check if a subdomain is available |
| `mug workspace archive` | Archive workspace (365-day data retention) |
| `mug workspace restore` | Restore an archived workspace (opens Stripe for paid tiers) |
| `mug workspace delete` | Permanently delete an archived workspace |
| `mug workspace export` | Export workspace data as `.tar` (`--categories <list>`, `--all`) |
| `mug create workspace <name>` | Register workspace (`--subdomain <slug>`, `--tier free\|starter\|pro\|business`) |
| `mug account email <new-email>` | Change account email (verifies both old and new email) |
| `mug account invites` | Show pending incoming and sent invites |
| `mug account accept <id>` | Accept a workspace invite |
| `mug account decline <id>` | Decline a workspace invite |
| `mug whoami` | Show account email and current workspace |
| `mug workspaces` | List all workspaces — cloud account and local machine |

### Webhooks & Issues

| Command | Description |
|---------|-------------|
| `mug webhooks` | List webhook URLs, inbound channels, and event triggers |
| `mug issue` | File a bug report or feature request on GitHub (`--dry-run` to preview) |
| `mug slack setup` | Set up Slack app (interactive — creates app, stores credentials) |
| `mug slack token` | Set or rotate Slack bot/refresh tokens (`--access-token`, `--refresh-token`) |

### Deployment

| Command | Description |
|---------|-------------|
| `mug validate` | Check workspace for issues before deploying. `--verbose` for info-level, `--json` for structured output. |
| `mug deploy` | Bundle and deploy to Cloudflare. Requires `MUG_API_KEY` in `.mug/secrets`. `--json` for structured output. |

### Production workflow

```bash
mug secret set MUG_API_KEY=<your-key>    # one-time setup
mug dev                                   # test locally
mug validate                              # check for issues
mug deploy --dry-run                      # preview what would change
mug deploy                                # deploy to production
mug run <workflow> --cloud                # trigger in production
mug status                                # check drift + schedule health
mug status <workflow> <instanceId>        # check instance status
```
