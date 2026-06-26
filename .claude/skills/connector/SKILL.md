---
name: connector
description: Build a connector for an external API. Walks through the full pipeline — research, discover, gather, verify, scaffold — and wires it into the workspace. Supports read-only sources and bidirectional connectors with write actions.
argument-hint: "<product name>"
---

# Build a Connector

Build a connector that syncs data from an external API into this workspace's local database. Connectors can be **read-only** (sync only, using `source()`) or **bidirectional** (sync + write-back, using `connector()`).

## Input

Product name: `$ARGUMENTS`

If no product name provided, ask the user what product or service they want to connect to.

For full API reference (all pagination styles, rate limit config, sync config, error retry, write verbs), see `.mug/docs/sources.md`. For `ctx.credential()` resolution chain, see `.mug/docs/api.md`. For `ctx.action()` usage in workflows, see `.mug/docs/api.md`.

## Quick path — write a source directly

For simple APIs where you already know the endpoints and auth, skip the pipeline and write the source file directly. See `.mug/docs/sources.md` for all interfaces.

### Read-only source (sync only)

```typescript
// connectors/<name>.ts
import { source } from "@mugwork/mug";

source({
  name: "<name>",
  database: "<name>",
  syncSchedule: "*/15 * * * *",
  tables: [{
    name: "<table>",
    primaryKey: "id",
    async fetch(ctx) {
      const token = await ctx.credential();
      const res = await fetch("https://api.example.com/items", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      return data.items;
    },
  }],
});
```

### Bidirectional connector (sync + write-back)

Use `connector()` when workflows need to push changes back to the external system via `ctx.action()`.

```typescript
// connectors/<name>.ts
import { connector } from "@mugwork/mug";

connector({
  name: "<name>",
  database: "<name>",
  syncSchedule: "*/15 * * * *",
  tables: [{
    name: "<table>",
    primaryKey: "id",
    async fetch(ctx) {
      const token = await ctx.credential();
      const res = await fetch("https://api.example.com/items", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return (await res.json()).items;
    },
    async get(ctx, recordId) {
      const token = await ctx.credential();
      const res = await fetch(`https://api.example.com/items/${recordId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404) return null;
      return await res.json();
    },
    actions: {
      async create(ctx, fields) {
        const token = await ctx.credential();
        const res = await fetch("https://api.example.com/items", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
        return await res.json();
      },
      async update(ctx, recordId, fields) {
        const token = await ctx.credential();
        const res = await fetch(`https://api.example.com/items/${recordId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
        return await res.json();
      },
      async delete(ctx, recordId) {
        const token = await ctx.credential();
        const res = await fetch(`https://api.example.com/items/${recordId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        return await res.json();
      },
    },
  }],
});
```

Connectors in `connectors/` are auto-discovered by `mug deploy` — no import needed. Store credentials with `mug secret set`, sync with `curl -X POST http://localhost:8787/sync/<name>`.

If the API is complex (pagination, rate limits, many endpoints), use the full pipeline below.

## Full pipeline

## Step 0 — Check the community catalog

Before researching from scratch, check if a verified connector already exists:

```
mug connector search "<product>"
```

If a match is found (especially with `[verified]` quality), clone it — this downloads the spec and scaffolds a ready-to-use connector file:

```
mug connector clone --slug <name>
```

Then configure credentials (Step 4) and optionally run `mug connector verify` against your own API credentials to confirm it works. If no match is found, continue with the full pipeline below.

## Step 1 — Research the API

Before running any CLI commands, research the product's API:

1. Search for `<product> API documentation`, `<product> developer portal`, `<product> developer docs`
2. Search for `<product> openapi spec` or `<product> swagger spec`
3. Check if Zapier, Make, or n8n have integrations (implies an API exists)
4. Determine:
   - **Does it have an API?** (yes/no)
   - **API type?** (rest, graphql, etc.)
   - **Docs URL?** (developer portal or API reference)
   - **OpenAPI spec URL?** (direct link to .json or .yaml spec file, if one exists)
   - **Auth method?** (bearer, api-key, oauth2, basic)
   - **Tier:** 1 = has an OpenAPI spec, 2 = has docs but no spec, 3 = no docs

Present your findings to the user and confirm before proceeding.

## Step 2 — Discover

Run `mug connector discover` with your research findings:

```
mug connector discover "<product>" \
  --tier <1|2|3> \
  --has-api \
  --api-type <type> \
  --docs-url "<url>" \
  --spec-url "<url>" \
  --auth-type <type> \
  [--zapier] [--make] [--n8n] \
  [--notes "<anything notable>"]
```

Omit flags you don't have data for. Use `--no-api` instead of `--has-api` if no API exists (pipeline stops here).

## Step 3 — Gather the spec

The discover output tells you which gather path to use.

**Tier 1 (has spec URL):**
```
mug connector gather --slug <name> --from-spec "<spec-url>"
```

**Tier 2 (has docs, no spec):**
Read the API documentation. Write an OpenAPI 3.x spec covering the key list endpoints, auth scheme, and parameters. Save it to a `.yaml` file, then:
```
mug connector gather --slug <name> --from-file <your-spec-file>
```

**Tier 3 (no docs):**
Ask the user to capture browser traffic as a HAR file while using the product, then:
```
mug connector gather --slug <name> --from-har <har-file>
```

Check the gather output — it reports endpoint count and quality score. If quality is low, review the spec and fix issues before proceeding.

## Step 4 — Set up credentials

**Ask the user for their API credentials.** Never guess, generate, or skip this step.

Once you have the credentials:

1. Store the credential securely:
```bash
mug secret set <SLUG>_API_KEY=<the credential>
```

2. Add the source config to `mug.json` with syncs configured (references the credential, doesn't store it):
```json
"sources": {
  "<slug>": {
    "auth": {
      "type": "<bearer|api-key|basic|oauth2>",
      "value": "<the credential>"
    },
    "baseUrl": "<API base URL>",
    "syncs": {
      "<slug>": {
        "database": "<slug>"
      }
    }
  }
}
```

**The `syncs` entry is required** — without it, data won't sync to the local database or appear in the workspace explorer. The `database` value must match the connector's `database` field. The sync schedule is set via `syncSchedule` in the connector's `source()` or `connector()` call (not in mug.json). Common schedules: `*/15 * * * *` (every 15 min), `0 * * * *` (hourly), `0 */6 * * *` (every 6 hours), `0 0 * * *` (daily at midnight).

For `api-key` auth, also include `"header": "<header-name>"` in the auth object.

Note: credentials in `mug.json` sources are used for local dev and sync. For production, `mug deploy` sends secrets from `.mug/secrets` automatically.

## Step 5 — Verify against the live API

```
mug connector verify --slug <name> --source <name>
```

This runs 7 probes against the live API and enriches the spec with `x-mug-*` annotations that the scaffold step uses. **Do not skip this step** — without it, the generated source won't have pagination, rate limit, or sync config.

Review the probe results. If auth fails, fix the source config and re-run. If endpoints are unreachable, check the base URL.

## Step 6 — Scaffold the source

```
mug connector scaffold --slug <name>
```

This generates `connectors/<slug>.ts` using the enriched spec.

## Step 7 — Review the generated connector

Connectors in `connectors/` are auto-discovered by `mug deploy` — no import needed.

1. Read the generated file. Review it for:
   - Correct base URL
   - Correct auth credential name
   - Sensible table names and primary keys
   - Appropriate pagination config
   - Any endpoints that should be excluded

2. Make adjustments as needed. The generated code is a starting point — customize the table definitions, add filtering, rename tables, or adjust the `extractItems` function.

3. **If the API has write endpoints** and the scaffold generated `connector()` with `get()` and `actions`, verify the action methods match the API's expected request format. Check the API docs for required fields, ID formats, and response shapes.

4. **If the scaffold generated `source()` but you need write-back**, convert it to `connector()`:
   - Change `import { source }` to `import { connector }`
   - Change `source({` to `connector({`
   - Add a `get(ctx, recordId)` method to each table that needs write-back
   - Add an `actions: { create?, update?, delete? }` block with the appropriate API calls
   - See the "Bidirectional connector" example in the Quick path section above

5. Tell the user what was built: which tables, what sync strategy, whether write-back is available, and any manual steps remaining.

## Step 8 — Sync and verify data

1. Start the dev server if it isn't running:
   ```
   mug dev
   ```
   (Run in background or a separate terminal. If the dev server is already running, it auto-detects the new connector — no restart needed.)

2. Trigger the first sync. Check the dev server output for the port — it auto-selects a free port starting from 8787:
   ```
   curl -s -X POST http://localhost:<port>/sync/<slug>
   ```
   The sync response includes ready-to-use commands:
   - `query` — a working `mug query` command to check the data immediately
   - `pull` — `mug pull databases/<slug>` to download the source's tables locally
   - `push` — `mug push databases/<slug>` to upload local changes back

3. Verify data landed using the `_workspace` database (this is where synced data lives):
   ```
   mug query _workspace "SELECT count(*) FROM <slug>_<first-table>"
   ```
   If count is 0 or the query fails, check the source's `fetch` function and the sync response for errors.

**Where synced data lives:** Synced data goes into the unified `_workspace` database (a Durable Object), not into `databases/<slug>.db` files. Tables are prefixed with the source name: `<slug>_<table>`. The dev server writes data back to local `databases/<slug>.db` files in the background, but this is async — `mug query _workspace` is the reliable immediate path. To get a local copy on demand: `mug pull databases/<slug>`.

## Step 9 — Show the user their data

Query through the unified workspace database. Tables are prefixed with the source slug:

```
mug query _workspace "SELECT * FROM <slug>_<table> LIMIT 5"
```

If you pulled the database locally (`mug pull databases/<slug>`), you can query the local file without the prefix:

```
mug query <slug> "SELECT * FROM <table> LIMIT 5"
```

If there are multiple tables with a relationship, demonstrate a cross-table JOIN:

```
mug query _workspace "SELECT a.name, b.name FROM <slug>_<table_a> a JOIN <slug>_<table_b> b ON a.<fk> = b.id"
```

If there are other sources already connected, demonstrate a **cross-source JOIN** — this is the unified database payoff:

```bash
# From the CLI — _workspace auto-routes through the dev server
mug query _workspace "SELECT p.address, i.amount FROM <source1>_<table> p JOIN <source2>_<table> i ON p.id = i.property_id"
```

```typescript
// In a workflow — ctx.query() already uses the unified database
const enriched = await ctx.query(
  "SELECT p.address, i.amount FROM <source1>_<table> p JOIN <source2>_<table> i ON p.id = i.property_id"
);
```

Show the user what's now queryable. All connector data is in one unified database — cross-source JOINs work naturally.

## Step 10 — Verify sync schedule

Confirm the `syncSchedule` in the connector's `source()` or `connector()` call matches what the user wants. Common schedules: `*/15 * * * *` (every 15 min), `0 * * * *` (hourly), `0 */6 * * *` (every 6 hours), `0 0 * * *` (daily at midnight). The workspace tier constrains the minimum interval (Free: daily, Starter: 15 min, Pro: 5 min, Business: 1 min).

## How data gets to production

Local syncs (via `mug dev` + `curl`) populate the dev server's `_workspace` Durable Object. The dev server writes data back to `databases/*.db` files in the background. To force a local copy: `mug pull databases/<slug>`. To upload local changes: `mug push databases/<slug>`.

`mug deploy` pushes code AND data: it bundles the workspace code, deploys it, then uploads any local databases that are newer than what's in production. If the database upload succeeds, the data is live immediately. If it fails (shown as a warning in deploy output), run `mug push --all` to retry.

After the first deploy, scheduled syncs run directly in production — the cron triggers the connector on Cloudflare, and data goes straight into the production Durable Object database. No local sync or push needed for ongoing data.
