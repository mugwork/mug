# Connectors & Sources — Full API Reference

Connectors are bidirectional API specs: sync data inbound and perform outbound actions. Sources are read-only connectors (sync only, no write verbs). Mug handles pagination, rate limiting, retries, and incremental sync. You write the definition — Mug runs the infrastructure.

For a guided walkthrough, use the `/connect` skill. For `ctx.credential()` resolution chain and credential wiring, see [api.md — ctx.credential](api.md#ctxcredentialname). For outbound actions via `ctx.action()`, see [api.md — ctx.action](api.md#ctxactionconnectorname).

## When to use `source()` vs `connector()`

| | `source()` | `connector()` |
|---|---|---|
| **Use when** | You only need to sync data inbound (read from external API → local SQLite) | Your workflows also need to write back to the external API via `ctx.action()` |
| **Tables have** | `fetch()` only | `fetch()` + `get()` + `actions` (create/update/delete/upsert) |
| **Rollback** | N/A | Supported — `ctx.rollback()` uses before-snapshots from `get()` |
| **Example** | Analytics dashboards, reporting, read-only data correlation | CRM updates, invoice status changes, appointment scheduling |

Start with `source()`. Convert to `connector()` when you need `ctx.action()` in a workflow. The scaffold command auto-detects write endpoints in OpenAPI specs and generates the appropriate type.

## ConnectorDef (bidirectional — read + write)

```typescript
import { connector } from "@mugwork/mug";

connector({
  name: string;             // unique identifier
  database: string;         // SQLite database name for synced data
  tables: ConnectorTableDef[];
  baseUrl?: string;
  rateLimits?: RateLimitConfig;
  errorRetry?: ErrorRetryConfig;
});
```

### ConnectorTableDef

Extends `TableDef` with `get()` for single-record reads and `actions` for write operations.

```typescript
interface ConnectorTableDef extends TableDef {
  get?: (ctx: SourceContext, recordId: string) => Promise<Record<string, unknown> | null>;
  actions?: {
    create?: (ctx: SourceContext, fields: Record<string, unknown>) => Promise<Record<string, unknown>>;
    update?: (ctx: SourceContext, recordId: string, fields: Record<string, unknown>) => Promise<Record<string, unknown>>;
    delete?: (ctx: SourceContext, recordId: string) => Promise<Record<string, unknown>>;
    upsert?: (ctx: SourceContext, recordId: string, fields: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
}
```

- `get()` — fetch a single record by ID. Required for pre-mutation snapshots and rollback. Should return `null` if the record doesn't exist.
- `actions.create()` — create a new record. Returns the created record (including any server-generated fields like ID).
- `actions.update()` — update an existing record. Returns the updated record.
- `actions.delete()` — delete a record. Returns the deleted record or confirmation.
- `actions.upsert()` — create or update based on whether the record exists.

### Example: Bidirectional Airtable Connector

```typescript
import { connector, type SourceContext } from "@mugwork/mug";

async function airtableFetch(url: string, ctx: SourceContext, options?: RequestInit) {
  const token = await ctx.credential("airtable_token");
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<any>;
}

export default connector({
  name: "airtable",
  database: "airtable",
  baseUrl: "https://api.airtable.com/v0/appXXXXXXXXXX",
  tables: [{
    name: "invoices",
    primaryKey: "id",
    async fetch(ctx) {
      const data = await airtableFetch("https://api.airtable.com/v0/appXXXXXXXXXX/Invoices", ctx);
      return data.records.map((r: any) => ({ id: r.id, ...r.fields }));
    },
    async get(ctx, recordId) {
      const data = await airtableFetch(`https://api.airtable.com/v0/appXXXXXXXXXX/Invoices/${recordId}`, ctx);
      return { id: data.id, ...data.fields };
    },
    actions: {
      async create(ctx, fields) {
        const data = await airtableFetch("https://api.airtable.com/v0/appXXXXXXXXXX/Invoices", ctx, {
          method: "POST", body: JSON.stringify({ fields }),
        });
        return { id: data.id, ...data.fields };
      },
      async update(ctx, recordId, fields) {
        const data = await airtableFetch(`https://api.airtable.com/v0/appXXXXXXXXXX/Invoices/${recordId}`, ctx, {
          method: "PATCH", body: JSON.stringify({ fields }),
        });
        return { id: data.id, ...data.fields };
      },
      async delete(ctx, recordId) {
        const data = await airtableFetch(`https://api.airtable.com/v0/appXXXXXXXXXX/Invoices/${recordId}`, ctx, {
          method: "DELETE",
        });
        return { id: data.id, deleted: true };
      },
    },
  }],
});
```

## SourceDef

```typescript
import { source } from "@mugwork/mug";

source({
  name: string;             // unique identifier, used in sync URLs and CLI
  database: string;         // SQLite database name (one DB per source)
  tables: TableDef[];       // tables to sync
  baseUrl?: string;         // API root URL, prepended to table endpoints
  rateLimits?: RateLimitConfig;
  errorRetry?: ErrorRetryConfig;
});
```

## TableDef

Each table maps to one API endpoint (or custom fetch function).

```typescript
interface TableDef {
  name: string;           // SQLite table name
  primaryKey: string;     // column used for upsert (usually "id")
  endpoint?: string;      // URL path appended to source's baseUrl
  fetch: (ctx: SourceContext) => Promise<Record<string, unknown>[]>;
  extractItems?: (body: unknown) => Record<string, unknown>[];
  pagination?: PaginationConfig;
  sync?: SyncConfig;
}
```

### fetch function

The `fetch` function is the core of a table definition. It makes the API call and returns an array of records. Each record becomes a row in the SQLite table — columns are auto-detected from keys.

```typescript
tables: [{
  name: "contacts",
  primaryKey: "id",
  async fetch(ctx) {
    const token = await ctx.credential();
    const res = await fetch("https://api.example.com/contacts", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.contacts;
  },
}]
```

When `endpoint` and `pagination` are set, the sync runtime handles fetching automatically — `fetch` is only called for custom/non-paginated endpoints.

### extractItems

When using automatic pagination (endpoint + pagination config), the sync runtime needs to extract the array of items from the API response body. By default, it checks these keys in order: `data`, `results`, `records`, `items`, `entries`. If the response is a top-level array, it uses that directly.

Override `extractItems` when the API wraps results differently:

```typescript
extractItems: (body) => (body as any).response.contacts,
```

## SourceContext

Passed to `fetch` functions. Provides credentials and sync state.

```typescript
interface SourceContext {
  credential: (name?: string) => Promise<string>;
  lastSync: string | null;  // ISO 8601 timestamp of last successful sync
}
```

### credential(name?)

Returns a secret value from `.mug/secrets`. Without a name argument, returns the default credential for the source. With a name, returns a specific secret.

```typescript
const token = await ctx.credential();          // default credential
const apiKey = await ctx.credential("api_key"); // named secret
```

### Auth types in mug.json

Each source entry in `mug.json` has an `auth` object that tells the runtime how to send credentials. The `auth.type` determines the HTTP auth mechanism:

- `"bearer"` — sends `Authorization: Bearer <token>`
- `"basic"` — sends `Authorization: Basic <base64>`
- `"oauth2"` — managed by `mug auth <provider>`, tokens refreshed automatically
- `"api-key"` — sends the credential in a custom HTTP header. **Requires `auth.header`** to specify which header name the API expects, since APIs use different header names (e.g., `X-API-Key`, `Api-Token`, `Authorization`).

Example `api-key` config in `mug.json`:

```json
"auth": { "type": "api-key", "value": "MY_API_KEY", "header": "X-API-Key" }
```

The `value` field references a secret name from `.mug/secrets` (set via `mug secret set`). The `header` field tells the runtime which HTTP header to send the credential in. This field is required for `api-key` type.

### lastSync

ISO 8601 timestamp of the last successful sync for this table, or `null` on first sync. Use this for incremental sync — only fetch records updated after this timestamp.

```typescript
async fetch(ctx) {
  let url = "https://api.example.com/contacts";
  if (ctx.lastSync) {
    url += `?updated_since=${ctx.lastSync}`;
  }
  // ...
}
```

## PaginationConfig

Handles automatic pagination across four styles. Set on a `TableDef` alongside `endpoint`.

```typescript
interface PaginationConfig {
  style: "cursor" | "offset" | "page" | "link-header";

  // cursor style
  cursorParam?: string;      // query param name (default: "cursor")
  cursorPath?: string;       // JSON path to next cursor in response (default: "next_cursor")

  // offset style
  offsetParam?: string;      // query param name (default: "offset")

  // page style
  pageParam?: string;        // query param name (default: "page")

  // shared
  pageSizeParam?: string;    // query param for page size
  defaultPageSize?: number;  // items per page (default: 100)
  maxPageSize?: number;      // maximum page size
}
```

### Cursor pagination

Most modern APIs (Airtable, Slack, HubSpot). The API returns a cursor token; send it back to get the next page.

```typescript
pagination: {
  style: "cursor",
  cursorParam: "cursor",        // ?cursor=<value>
  cursorPath: "meta.next_cursor", // where to find cursor in response JSON
}
```

The runtime stops when `cursorPath` resolves to a falsy value (null, undefined, empty string).

### Offset pagination

APIs that use skip/offset (older REST APIs). The runtime increments the offset by `defaultPageSize` each page.

```typescript
pagination: {
  style: "offset",
  offsetParam: "offset",    // ?offset=200
  defaultPageSize: 100,     // increment per page
}
```

Stops when `extractItems` returns fewer items than `defaultPageSize`.

### Page pagination

APIs that use page numbers. The runtime increments the page number each request.

```typescript
pagination: {
  style: "page",
  pageParam: "page",         // ?page=3
  defaultPageSize: 50,
}
```

Stops when the response includes `total_pages`/`totalPages` and current page >= total, or when `extractItems` returns an empty array.

### Link-header pagination

Reserved for APIs that use `Link` HTTP headers (GitHub API style). Currently parses but does not follow — use cursor pagination for these APIs.

## RateLimitConfig

Controls request pacing to avoid hitting API rate limits.

```typescript
interface RateLimitConfig {
  requestsPerSecond?: number;
  requestsPerMinute?: number;
}
```

The runtime inserts a delay between requests. `requestsPerSecond` takes precedence over `requestsPerMinute` if both are set.

```typescript
rateLimits: {
  requestsPerSecond: 5,  // max 5 requests/sec = 200ms between requests
}
```

The runtime also respects `Retry-After` headers from 429 responses automatically.

## SyncConfig

Controls incremental sync behavior — how the runtime filters for new/updated records.

```typescript
interface SyncConfig {
  filterParam?: string;        // query param for "updated since" filter
  filterFormat?: "iso8601" | "unix" | "epoch_ms";  // timestamp format
  updatedAtField?: string;     // field name for last-updated timestamp
  deletedAtField?: string;     // field name for soft-delete timestamp
  isDeletedField?: string;     // boolean field indicating deletion
  deletionStrategy?: "soft-delete-field" | "tombstone-endpoint" | "full-sync-only";
}
```

### Incremental sync

When `filterParam` is set and `lastSync` is available, the runtime appends a filter to the request URL:

```typescript
sync: {
  filterParam: "updated_since",
  filterFormat: "iso8601",     // sends ISO 8601 string
}
// Result: ?updated_since=2024-01-15T10:30:00.000Z
```

### Deletion strategies

- **`soft-delete-field`** — records have a `deletedAtField` or `isDeletedField`. Mug sets `_mug_deleted_at` on matching rows.
- **`tombstone-endpoint`** — API has a separate endpoint for deleted records.
- **`full-sync-only`** — no incremental support. Every sync fetches all records.

## ErrorRetryConfig

Controls automatic retry behavior for failed requests.

```typescript
interface ErrorRetryConfig {
  maxRetries?: number;      // default: 3
  retryOn5xx?: boolean;     // retry server errors (default: true)
  retryOn429?: boolean;     // retry rate limit errors (default: true)
  backoffMs?: number;       // initial backoff delay in ms (default: 1000)
}
```

Uses exponential backoff: `backoffMs * 2^(attempt-1)`. For 429 responses, the runtime uses the `Retry-After` header if present.

```typescript
errorRetry: {
  maxRetries: 5,
  retryOn5xx: true,
  retryOn429: true,
  backoffMs: 2000,   // 2s, 4s, 8s, 16s, 32s
}
```

## System columns

Synced tables automatically get these columns:

- `_mug_synced_at` — ISO 8601 timestamp of when the row was last synced
- `_mug_deleted_at` — ISO 8601 timestamp if the row was soft-deleted (null if active)

Always filter for active records:
```sql
SELECT * FROM contacts WHERE _mug_deleted_at IS NULL
```

## CLI commands

```bash
mug connector discover "<product>"    # record API availability and research
mug connector gather --slug <name>    # produce OpenAPI spec (from URL, file, or HAR)
mug connector verify --slug <name>    # run 7-probe verification against live API
mug connector scaffold --slug <name>  # generate TypeScript source from enriched spec
mug connector init <product>          # full pipeline: discover -> gather -> verify -> scaffold
```

### Trigger sync locally

```bash
mug dev                                           # start dev server
curl -s -X POST http://localhost:8787/sync/<name>  # trigger sync
mug sql <database> "SELECT count(*) FROM <table>"    # verify
```

## Complete example

```typescript
import { source } from "@mugwork/mug";

source({
  name: "hubspot",
  database: "hubspot",
  baseUrl: "https://api.hubapi.com",
  rateLimits: { requestsPerSecond: 10 },
  errorRetry: { maxRetries: 3, retryOn429: true, backoffMs: 1000 },
  tables: [
    {
      name: "contacts",
      primaryKey: "id",
      endpoint: "/crm/v3/objects/contacts",
      extractItems: (body) => (body as any).results,
      pagination: {
        style: "cursor",
        cursorParam: "after",
        cursorPath: "paging.next.after",
        defaultPageSize: 100,
      },
      sync: {
        filterParam: "filterGroups",
        filterFormat: "iso8601",
        updatedAtField: "updatedAt",
        deletionStrategy: "soft-delete-field",
        isDeletedField: "archived",
      },
      async fetch(ctx) {
        const token = await ctx.credential();
        const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
          headers: { Authorization: `Bearer ${token}` },
        });
        return ((await res.json()) as any).results;
      },
    },
    {
      name: "deals",
      primaryKey: "id",
      endpoint: "/crm/v3/objects/deals",
      extractItems: (body) => (body as any).results,
      pagination: {
        style: "cursor",
        cursorParam: "after",
        cursorPath: "paging.next.after",
      },
      async fetch(ctx) {
        const token = await ctx.credential();
        const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
          headers: { Authorization: `Bearer ${token}` },
        });
        return ((await res.json()) as any).results;
      },
    },
  ],
});
```
