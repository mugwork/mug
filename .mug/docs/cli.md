# CLI — Full Command Reference

Complete reference for all `mug` CLI commands. For a compact table of every command and flag, see [api.md — CLI Quick Reference](api.md#cli-quick-reference).

## Workspace setup

### mug init [name]

Create a new Mug workspace. If logged in, auto-registers the workspace with the Mug platform and reserves the subdomain. If not logged in, scaffolds locally only — register later with `mug create workspace` or on first `mug deploy`.

```bash
mug init my-client        # create workspace in ./my-client/
mug init                  # create workspace in current directory
```

Creates the workspace structure:
```
my-client/
├── mug.json              # workspace config
├── CLAUDE.md             # AI agent instructions (with mug:start/mug:end block)
├── AGENTS.md             # AI agent instructions for Codex
├── .cursor/rules/mug.mdc # Cursor rules
├── .claude/skills/       # Claude Code skills (connect, workflow, form)
├── .agents/skills/       # Codex skills
├── .mug/
│   ├── docs/             # platform reference docs (sources, workflows, forms, portals, CLI)
│   └── secrets           # workspace credentials (.gitignored)
├── connectors/           # connector source files (auto-discovered)
├── workflows/            # workflow files (auto-discovered)
├── agents/               # AI agent configs
├── surfaces/             # form and portal JSON configs
├── files/                # static files synced to R2 (assets, templates, CSVs)
│   └── .remote           # manifest of production files
├── databases/            # local SQLite files synced to production DOs (.db gitignored)
│   └── .remote           # manifest of production databases
├── package.json
└── .gitignore
```

### mug clone [name]

Clone an existing workspace from Mug cloud to your local machine. Creates a new directory, scaffolds the workspace structure, and connects it to the cloud workspace. Files and databases stay remote — use `mug pull --all` to download locally if needed.

```bash
mug clone                 # shows workspace picker if you have multiple
mug clone acme            # clone by name, subdomain, or ID
```

Requires `mug login` first.

### mug update

Regenerate platform files locally. Run after updating the CLI, changing `mug.json`, or restructuring your workspace. Warns if the CLI is outdated.

```bash
mug update
```

`mug update` updates platform files only — your code in `connectors/`, `workflows/`, `agents/` is safe. Framework types come from the `@mugwork/mug` package.

Updates (down — production to local):
- **Scaffolding** — creates missing `files/` and `databases/` directories with `.remote` manifests
- **Instruction files** — CLAUDE.md, AGENTS.md, .cursor/rules/mug.mdc (regenerates the `mug:start`/`mug:end` block)
- **Skills** — .claude/skills/, .agents/skills/, .cursor/rules/
- **Docs** — .mug/docs/ (platform reference documentation)
- **Remote manifests** — fetches production state into `files/.remote` and `databases/.remote`

Uploads (up — local to production):
- **Local files** — new or changed files in `files/` are uploaded to R2
- **Local databases** — new or changed `.db` files in `databases/` are pushed to production DOs

Output: `Synced 2 instruction files, 6 skills, 4 docs`

### mug pull

Download remote files or databases to the local workspace.

```bash
mug pull files/templates/invoice.html     # download a specific file
mug pull databases/crm                     # download a database as .db
mug pull --all                             # download everything remote
```

Files are written to `files/` and databases to `databases/`. The `.remote` manifest is updated after each pull. Existing local databases are backed up before overwrite.

### mug push

Upload local files or databases to production.

```bash
mug push databases/crm                     # upload a local database to production
mug push files/templates/invoice.html      # upload a specific file
mug push --all                             # upload all local files and databases
```

Reads from `databases/*.db` and `files/`, uploads to production DOs and R2. The `.remote` manifest is updated after each push.

### mug login

Authenticate with the Mug platform via email verification.

```bash
mug login
```

Prompts for email, sends a 6-digit verification code, and stores the session token in `~/.mug/credentials`. Creates a new account on first use.

### mug whoami

Show account email and current workspace.

```bash
mug whoami
```

Displays account email. If run inside a workspace directory, also shows the current workspace name, plan tier, and role. Points to `mug workspaces` for full listing.

### mug workspaces

List all workspaces — cloud account and local machine.

```bash
mug workspaces
```

Merges cloud workspaces (from your account) with locally cloned workspaces (tracked in `~/.mug/workspaces.json`). Shows name, tier, role, URL, and local path for each. Marks the current workspace (matching cwd). Local-only workspaces not registered on the platform are listed separately. Works offline with local data only if not logged in.

### mug start

Get started — orientation for new workspaces, progress checklist for existing ones.

```bash
mug start
```

In a new workspace (no connectors, workflows, agents, or surfaces), shows a brief orientation explaining what Mug is and what you can build, then recommends starting with a connector. In an existing workspace, shows a progress checklist of the 5 primary components (connectors, workflows, agents, surfaces, Slack app) with what's built and what to build next.

## Development

### mug dev

Start the local development server.

```bash
mug dev                    # auto-detects ports from 8787
mug dev --port 9000        # pin to a specific port
mug dev --tunnel           # expose via Cloudflare Quick Tunnel (requires cloudflared)
```

Starts a Wrangler dev server (default port 8787). Provides:
- Local workflow execution with hot reload
- Source sync endpoints (`POST /sync/<source-name>`)
- Surface rendering (forms, portals, home screen)
- Workspace explorer at `/explorer`
- Workflow test runner at `/_dev/run/<workflow-name>`
- Local Durable Object for SQLite databases

### mug shutdown

Gracefully stop the running dev server. Writes back databases from Durable Objects to `databases/*.db` files.

```bash
mug shutdown
```

### mug webhooks

List all webhook URLs, inbound message channels, and event triggers for this workspace.

```bash
mug webhooks
```

Shows the production URLs for webhook-triggered workflows, inbound SMS/email/Slack endpoints, and data change triggers. Useful after `mug deploy` to see what URLs to configure in external systems.

### mug run \<workflow\>

Execute a workflow.

```bash
mug run invoice-followup              # run locally
mug run invoice-followup --production # run in production (Cloudflare Workflows)
```

Local runs execute synchronously and print step-by-step output. Production runs create a Cloudflare Workflow instance and return an instance ID.

### mug status \<workflow\> \<instanceId\>

Check the status of a production workflow instance.

```bash
mug status invoice-followup inv-followup-1234567890-abc123
```

### mug logs [workflow]

View workflow execution history. Automatically tries the local dev server first; if no dev server is running, fetches production logs.

```bash
mug logs                             # all recent runs (dev or production)
mug logs invoice-followup            # runs of a specific workflow
mug logs --production                # force production logs (skip dev server check)
mug logs invoice-followup --limit 20 # more entries
mug logs --json                      # JSON output for scripting
```

Shows per-run summary: status, duration, step count, errors. Includes per-step details with timing, input/output, and token usage. Production logs are stored per-workspace and retain the last 1000 runs.

### mug sql \<database\> \<sql\> (alias: mug query)

Run SQL against a workspace database. Reads and writes `databases/<database>.db` directly — no dev server needed.

```bash
mug sql hubspot "SELECT count(*) FROM contacts"
mug sql quickbooks "SELECT * FROM invoices WHERE status = 'overdue' LIMIT 10"
mug sql narvick "INSERT INTO time_off_requests (employee, type, hours) VALUES ('jane', 'pto', 8)"
mug sql main "CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, email TEXT)"
```

Supports both reads and writes. Writes auto-create the database file if it doesn't exist. The `databases/` directory is the local source of truth — `mug push` uploads to production, `mug pull` downloads from production.

Flags:
- `--json` — JSON output
- `--production` — run against production database
- `--dev` — route through dev server instead of local file (for debugging)

### mug usage

Show workspace usage across all 6 billing dimensions: operations, database records, file storage, email sends, SMS sends, AI credits. Displays tier, limits, progress bars, and overage pack status. Includes AI model breakdown from Analytics Engine.

```bash
mug usage                        # current period usage with progress bars
mug usage --period 2026-04       # view a specific billing period
mug usage --json                 # structured JSON output
```

### mug billing

View or update workspace billing and overage settings. Per-unit overages are enabled by default with a tier-appropriate dollar cap.

```bash
mug billing                              # show plan, email, per-meter overage status + caps
mug billing --overage operations=on      # toggle overage on for a meter
mug billing --overage sms=off            # toggle overage off (hard cap at plan limit)
mug billing --cap ai_credits=50          # set overage cap to $50/mo for a meter
mug billing --email billing@co.com       # set billing notification email
```

Meter names: `operations`, `records`, `storage_bytes`, `email`, `sms`, `ai_credits`.

## Connectors

### mug connector discover \<product\>

Record API availability for a product. First step of the connector pipeline.

```bash
mug connector discover "HubSpot" \
  --tier 1 \
  --has-api \
  --api-type rest \
  --docs-url "https://developers.hubspot.com/docs/api" \
  --spec-url "https://api.hubspot.com/api-catalog-public/v1/apis" \
  --auth-type oauth2 \
  --zapier --make \
  --notes "V3 API is current, V1 deprecated"
```

Flags:
- `--tier <1|2|3>` — 1: has OpenAPI spec, 2: has docs, 3: no docs
- `--has-api` / `--no-api` — whether an API exists
- `--api-type <type>` — rest, graphql, soap, etc.
- `--docs-url <url>` — developer portal URL
- `--spec-url <url>` — OpenAPI spec URL
- `--auth-type <type>` — bearer, api-key, oauth2, basic
- `--zapier`, `--make`, `--n8n` — integration platform availability
- `--notes <text>` — additional notes

### mug connector gather

Produce an OpenAPI spec from a connector.

```bash
mug connector gather --slug hubspot --from-spec "https://api.hubspot.com/spec.json"
mug connector gather --slug custom-api --from-file ./my-spec.yaml
mug connector gather --slug webapp --from-har ./traffic.har
```

Inputs:
- `--from-spec <url>` — download and normalize an existing OpenAPI spec
- `--from-file <path>` — read a local OpenAPI spec file
- `--from-har <path>` — extract API endpoints from a HAR file

### mug connector verify

Run 7-probe verification against the live API. Enriches the spec with `x-mug-*` annotations for pagination, rate limits, and sync config.

```bash
mug connector verify --slug hubspot --source hubspot
```

Requires a source configured in `mug.json` with valid credentials.

### mug connector scaffold

Generate a TypeScript source file from the enriched spec.

```bash
mug connector scaffold --slug hubspot
```

Creates `connectors/<slug>.ts` with table definitions, pagination config, and sync settings derived from the verified spec.

### mug connector init \<product\>

Full pipeline: discover, gather, verify, scaffold in one command.

```bash
mug connector init hubspot
```

Interactive — prompts for research data, credentials, and spec source.

### mug connector search \<query\>

Search the community connector catalog for pre-built connector specs.

```bash
mug connector search "hubspot"
mug connector search "crm" --json
```

Returns matching connectors with endpoint count, quality level, and auth type.

### mug connector pull

Download a connector spec from the community catalog into your workspace.

```bash
mug connector pull --slug hubspot
```

Saves to `connectors/.specs/<slug>/`. From there, run `mug connector verify` or `mug connector scaffold`.

## Issues

### mug issue

File a bug report or feature request on GitHub (github.com/mugwork/mug).

```bash
mug issue                        # interactive interview — prompts for category, description, steps
mug issue --dry-run              # print issue body without submitting
mug issue --attach-diagnostics   # include workspace diagnostics in the issue
mug issue --token <token>        # use a specific GitHub token instead of env vars
```

Walks through a structured interview: category, what you were doing, what happened, what you expected, steps to reproduce, and relevant files. Auto-collects workspace context (CLI version, source/workflow/agent counts). Submits to GitHub if `MUG_GITHUB_TOKEN` or `GITHUB_TOKEN` is set; otherwise prints the issue body for manual copy.

## Forms

### mug form init \<name\>

Scaffold a form and its handler workflow.

```bash
mug form init service-request
```

Creates:
- `workflows/<name>.ts` — workflow that creates the form via `ctx.collect()`
- `workflows/handle-<name>.ts` — handler workflow for submissions

### mug form validate [name]

Validate form schemas for errors.

```bash
mug form validate                  # validate all forms
mug form validate service-request  # validate specific form
```

Checks: field types, required options for select fields, condition references, page IDs, access mode config.

### mug form list

List all forms in the workspace with their URLs.

```bash
mug form list
```

## Secrets

### mug secret set \<KEY=VALUE\>

Store a secret in `.mug/secrets`.

```bash
mug secret set AIRTABLE_API_KEY=pat_xxxxx
mug secret set MUG_API_KEY=mug_xxxxx
mug secret set WEBHOOK_SECRET=whsec_xxxxx --production  # sync to production immediately
```

Secrets are:
- Loaded automatically by `mug dev`
- Sent to production by `mug deploy`
- Never stored in `mug.json`

Flags:
- `--production` — sync the secret to production via the dispatch endpoint

### mug secret list

List stored secret keys (not values). Shows "Local secrets (.mug/secrets):" followed by indented key names. Prints a hint to use `mug secret set` if no secrets are configured.

```bash
mug secret list
# Output:
# Local secrets (.mug/secrets):
#   AIRTABLE_API_KEY
#   TWILIO_AUTH_TOKEN
```

### mug secret remove \<KEY\>

Remove a secret from `.mug/secrets`.

```bash
mug secret remove AIRTABLE_API_KEY
```

## Auth

### mug auth \<provider\>

Connect a provider via OAuth. Supported providers depend on platform configuration.

```bash
mug auth airtable
```

Opens a browser for OAuth flow. Stores the credential in `.mug/secrets` on completion.

## Slack

### mug slack setup

Set up a Slack app for this workspace. Interactive flow — creates the app via Slack's manifest API, stores credentials.

```bash
mug slack setup
```

### mug slack token

Manually set Slack tokens. Use when `mug slack setup` can't be run interactively or to recover from token issues.

```bash
mug slack token --access-token xoxb-... --refresh-token xoxe-...
```

## Demo Mode

Demo mode lets you share deployed auth'd surfaces with stakeholders without requiring them to verify. The surface renders pre-authenticated as a specific identity.

### mug demo enable \<surface\> --as \<identity\>

Enable demo mode on a deployed surface.

```bash
mug demo enable employee-portal --as demo@example.com
mug demo enable time-off-form --as jane@acme.com --expires 30d
mug demo enable employee-portal --as demo@example.com --sms-to +15551234567
mug demo enable employee-portal --as demo@example.com --no-workflows
mug demo enable employee-portal --as demo@example.com --notify off
```

Options:
- `--as <identity>` — (required) email or phone to authenticate as
- `--expires <duration>` — expiry duration (default: `7d`). Accepts `Nd` (days) or `Nh` (hours).
- `--notify <mode>` — notification routing mode (default: `demo-user`):
  - `demo-user` — redirect all notifications to the demo identity (`--as`). Channels that don't match the identity type (e.g. SMS when identity is email) are suppressed unless overridden.
  - `dev` — redirect all notifications to the developer who ran the command. Email goes to your logged-in account email. SMS/Slack suppressed unless overridden.
  - `off` — suppress all notifications (workflow still runs, notifications logged but not sent).
- `--email-to <address>` — override: redirect email notifications to this address.
- `--sms-to <phone>` — override: redirect SMS notifications to this phone number.
- `--slack-to <channel>` — override: redirect Slack notifications to this channel/user.
- `--no-workflows` — suppress workflow execution entirely on surface submissions. The surface still renders and accepts input, but no workflow fires.

Per-channel overrides take precedence over the `--notify` mode. Each surface can demo as a different identity. After expiry, the surface silently reverts to requiring auth.

### mug demo disable \<surface\>

Immediately disable demo mode on a surface.

```bash
mug demo disable employee-portal
```

### mug demo status

Show all active demos for this workspace.

```bash
mug demo status
```

### Demo notifications and workflows

Notifications are **automatically routed** during demo mode — no manual guards needed. The `--notify` mode and per-channel overrides control where notifications go:

```bash
# Default: emails go to demo identity, SMS suppressed (identity is email)
mug demo enable employee-portal --as demo@example.com

# Redirect SMS to your phone for live demo
mug demo enable employee-portal --as demo@example.com --sms-to +15551234567

# Suppress all notifications, workflows still run
mug demo enable employee-portal --as demo@example.com --notify off

# Show the form only, no workflows fire on submit
mug demo enable employee-portal --as demo@example.com --no-workflows
```

Suppressed notifications are still logged in `mug logs` — you'll see "suppressed (demo mode: demo-user)" in the step output so you can verify the workflow would have fired.

`ctx.isDemo` is still available for guarding non-notification side effects (destructive writes, external API calls):

```typescript
export default workflow("handle-request", async (ctx) => {
  // Notifications auto-routed by demo config — no guard needed
  await ctx.notify.sms({ to: params.manager_phone, message: "New request" });

  // Guard other side effects manually
  if (ctx.isDemo) return;
  await ctx.exec("operations", "UPDATE jobs SET status = 'approved' WHERE id = ?", [params.job_id]);
});
```

Create a demo persona (e.g. `demo@example.com`) in your auth table with curated demo data. The demo viewer sees exactly what that user would see.

## Workspace Management

### mug create workspace \<name\>

Register a new workspace on the Mug platform.

```bash
mug create workspace "Acme Inc"                         # free tier, auto-generates subdomain "acme-inc"
mug create workspace "Acme Inc" --subdomain acme        # custom subdomain
mug create workspace "Acme Inc" --tier starter           # paid tier (opens Stripe Checkout)
```

Options: `--subdomain <slug>` (auto-generated from name if omitted), `--tier <tier>` (free, starter, pro, business — default free). Updates `mug.json` with workspace ID and subdomain.

### mug workspace status

Show workspace metadata: name, ID, URL, custom domain, plan tier, role, version, last deploy.

### mug workspace plan

View current plan and change tier. Shows all tiers with prices, confirms selection. Calls Stripe Checkout for free→paid or paid→paid changes. Downgrade to free cancels subscription.

### mug workspace invite \<email\>

Send an admin invite to the workspace. Recipient gets an email and can accept via `mug account accept <id>`.

### mug workspace transfer \<email\>

Transfer workspace ownership. Sends an invite with owner role — ownership transfers when the recipient accepts. Requires confirmation.

### mug workspace remove \<email\>

Remove a member from the workspace.

### mug workspace members

List all members with role and join date. Also shows pending sent invites with invite IDs.

### mug workspace cancel-invite \<id\>

Cancel a pending invite you sent. Get invite IDs from `mug workspace members` or `mug account invites`.

### mug workspace check-subdomain \<subdomain\>

Check if a subdomain is available. Validates format (3-63 chars, lowercase alphanumeric + hyphens) and checks against reserved/taken subdomains.

### mug workspace archive

Archive workspace (365-day retention, restorable). Requires typing workspace name to confirm.

### mug workspace restore

Restore an archived workspace. Opens Stripe Checkout if the workspace was on a paid tier.

### mug workspace delete

Permanently delete an archived workspace. Workspace must be archived first. Requires typing workspace name to confirm. **Cannot be undone.**

### mug workspace export

Export workspace data as a `.tar` archive.

```bash
mug workspace export                    # show categories with file counts and sizes
mug workspace export --all              # download all categories
mug workspace export --categories config,code   # selective download
```

### mug account invites

Show pending incoming invites (workspace name, role, inviter) and sent pending invites (workspace name, email, role).

### mug account accept \<id\>

Accept a workspace invite. Use `mug account invites` to see pending invite IDs.

### mug account decline \<id\>

Decline a workspace invite.

### mug account email \<new-email\>

Change account email. Sends verification codes to both your current email and the new email — you must enter both codes to confirm the change.

## Agent Brain

### mug brain \<agent\>

Inspect an agent's brain memory. Shows entity count, facts, outcomes, unresolved struggles, and session history.

```bash
mug brain dispatch-bot              # overview with counts + recent struggles
mug brain dispatch-bot struggles    # unresolved struggles grouped by category
mug brain dispatch-bot entities     # all entities sorted by mention count
mug brain dispatch-bot outcomes     # recent outcomes with success rate
mug brain dispatch-bot sessions     # session history across workflows
mug brain dispatch-bot search <q>   # search the brain by keyword
```

Reads the local `agents/<name>/BRAIN.db`. Run `mug pull` to download runtime brain data from production.

## Deployment

### mug deploy

Bundle workspace code and deploy to Cloudflare Workers.

```bash
mug deploy
```

Requires `MUG_API_KEY` in `.mug/secrets`. Bundles TypeScript, validates, creates/updates the Worker with correct bindings, and uploads secrets.

### mug validate

Run static validation checks across the entire workspace — config, agents, surfaces, connectors, code patterns, and usage projections. Errors block `mug deploy`; warnings and info are advisory.

```bash
mug validate
mug validate --verbose    # include passing checks and info-level findings
mug validate --json       # machine-readable JSON output
```

#### Check codes by category

**AI Routing** — validates `ai.routing` and `ai.billing` in `mug.json`:

| Code | Severity | Description |
|------|----------|-------------|
| `INVALID_AI_TIER` | error | Routing tier is not `fast`, `balanced`, or `powerful` |
| `INVALID_AI_MODEL_FORMAT` | error | Model spec missing `provider/model` format |
| `UNKNOWN_AI_PROVIDER` | error | Provider not in supported list (openai, anthropic, workers-ai) |
| `INVALID_AI_BILLING_KEY` | error | Billing key is not `default`, `fast`, `balanced`, or `powerful` |
| `MISSING_AI_BILLING_SECRET` | error | Billing key references a secret not in `.mug/secrets` |

**Agents** — validates `agents/<name>/agent.json` and instruction files:

| Code | Severity | Description |
|------|----------|-------------|
| `AGENT_INVALID_JSON` | error | `agent.json` is not valid JSON |
| `AGENT_PARSE_ERROR` | error | `agent.json` could not be read |
| `AGENT_MISSING_MODEL` | error | No `model` field in `agent.json` |
| `AGENT_MODEL_NO_TOOLS` | error | Model does not support tool calling but agent has tools configured |
| `AGENT_INVALID_TIER` | error | Model routing tier is not `fast`, `balanced`, or `powerful` |
| `AGENT_MISSING_INSTRUCTIONS` | error | Instruction file (default `SOUL.md`) not found |
| `AGENT_INVALID_CAPS` | error | `maxTurns` outside 1-500 or `maxCredits` not positive |
| `AGENT_UNKNOWN_MODEL` | warning | Model not in the registry — will use as-is via AI Gateway |
| `AGENT_UNKNOWN_TOOL` | warning | Tool grant is not a standard grant — treated as custom |
| `AGENT_NO_CAPS` | warning | No cost caps set — agent could run indefinitely |
| `EMPTY_INSTRUCTION_FILE` | warning | Instruction file is very short (<50 chars) |
| `LEGACY_AGENT_FILES` | warning | Found `.ts`/`.js` files in agents dir instead of folder structure |
| `AGENT_MODEL_UNVERIFIED` | info | Model not in registry — cannot verify tool-calling support |

**Surfaces** — validates form and portal JSON in `surfaces/`:

| Code | Severity | Description |
|------|----------|-------------|
| `SURFACE_INVALID_JSON` | error | Surface JSON file is not valid JSON |
| `SURFACE_CONFIG_ERROR` | error | Config error: invalid SQL identifiers, bad query syntax, invalid embed origins |
| `HOME_UNKNOWN_SURFACE` | warning | `_home.json` references a surface ID that doesn't match any surface file |

**Code Patterns** — static analysis of TypeScript in all user code dirs:

| Code | Severity | Description |
|------|----------|-------------|
| `WORKERS_INCOMPATIBLE_IMPORT` | error | Imports a Node.js module not available in Workers (fs, net, child_process, etc.) |
| `ACTION_NO_CONNECTOR` | error | `ctx.action("name")` references a connector that doesn't exist |
| `WORKFLOW_SETTIMEOUT` | warning | Uses `setTimeout`/`setInterval` which won't survive durable checkpoints — use `ctx.sleep()` |
| `MISSING_SECRET` | warning | Code references a secret not in `.mug/secrets` |
| `ACTION_READ_ONLY_CONNECTOR` | warning | Calls write methods (create/update/delete) on a read-only `source()` connector |
| `WORKFLOW_HIGH_MAX_OPS` | info | `maxOperations` set above 1,000 — flagged for review |

**Connectors** — validates connector files in `connectors/`:

| Code | Severity | Description |
|------|----------|-------------|
| `DUPLICATE_CONNECTOR_DB` | error | Multiple connectors write to the same `database.table` — second sync overwrites first |
| `CONNECTOR_OAUTH_NO_SECRET` | warning | Connector uses OAuth patterns but referenced secrets are missing |
| `CONNECTOR_DUPLICATE_TABLE` | warning | Same table name appears twice within a single connector |
| `ACTION_NO_GET` | warning | Connector table has write actions but no `get()` — pre-mutation snapshots and rollback won't work |
| `CONNECTOR_NO_SCHEDULE` | info | No `syncSchedule` set — data only syncs on manual `mug run` |
| `SYNC_NO_CONSUMERS` | info | Connector syncs data but no workflows, agents, or surfaces reference the database |

**Usage Projections** — estimates monthly operations from schedules and compares to plan limits:

| Code | Severity | Description |
|------|----------|-------------|
| `USAGE_EXCEEDS_PLAN` | warning | Estimated monthly operations exceed the current plan's limit |
| `USAGE_HIGH_SYNC_FREQUENCY` | warning | Connector syncs at <5-minute intervals — consider longer interval if data changes infrequently |
| `USAGE_MANY_CONNECTORS_SHORT_INTERVAL` | warning | 5+ connectors sync at ≤5-min intervals |
| `USAGE_ACTION_OPS_PROJECTION` | info | Estimated monthly outbound action operations from scheduled workflows |
