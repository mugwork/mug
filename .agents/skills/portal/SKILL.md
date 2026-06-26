---
name: portal
description: Create a portal surface — tabbed, section-based pages that query workspace data. Sections include tables (with detail pages + actions), stats cards, progress bars, charts, galleries, text blocks, and accordions. Used for dashboards, employee portals, approval inboxes, status trackers.
argument-hint: "<portal name or description>"
---

# Create a Portal

Build a portal that displays data from the workspace database. Portals are config-driven JSON files with tabs and typed sections. They render at `https://<workspace>.mug.work/<portal-id>`.

Full API reference (all config fields, section types, formats, badge colors, action conditions): `.mug/docs/portals.md`

## Input

Portal name or description: `$ARGUMENTS`

If no argument provided, ask the user what they need. Clarify:
- What data should it show? (tables, metrics, charts, text)
- Who sees it? (public, verified identity, or restricted)
- Multiple concerns? (suggest tabs — e.g., "Time Off" + "Company")
- Any action buttons? (e.g., approve/deny — trigger workflows)

## Step 1 — Name and plan

Pick a kebab-case name (e.g., `employee-portal`, `approvals`, `inventory`).

Present a brief plan:
- Tab structure (single tab = no tab bar shown)
- Section layout per tab (stats at top, then table, etc.)
- Data sources (tables, queries)
- Access mode
- Action buttons (if any)

Wait for user confirmation.

## Step 2 — Scaffold the portal config

```bash
mug portal init <name>
```

Creates `surfaces/<name>.json` with a template config. Then edit to match the plan.

## Step 3 — Write the portal config

Portal configs are JSON files in `surfaces/`. The structure is:

```json
{
  "type": "portal",
  "title": "Employee Portal",
  "access": { "mode": "auth", "method": "email", "table": "employees", "matchColumn": "email", "sessionDuration": "7d" },
  "sections": [
    { "type": "stats", "query": "...", "items": [...] }
  ],
  "tabs": [
    {
      "id": "main",
      "label": "Dashboard",
      "color": "#3b82f6",
      "countQuery": "SELECT count(*) FROM items WHERE owner = :user",
      "sections": [
        { "type": "table", "query": "...", "columns": [...], "detail": {...}, "actions": [...] }
      ],
      "links": [{ "label": "Submit Request", "href": "/request-form?from=/request-form-portal&fromLabel=Back to Portal" }]
    }
  ]
}
```

- **No `database` field needed** — portals query the unified workspace database by default. Cross-source JOINs work in any section query. Table names auto-resolve when unique across sources; use prefixed names (`airtable_contacts`) when ambiguous.
- **Top-level `sections`** render above the tab bar and stay visible across all tabs. Use for summary stats or announcements that apply globally.
- **Tab `color`** sets the tab's text + underline color (e.g., amber for "Pending", green for "Approved").
- **Tab `countQuery`** shows a dynamic count badge: `"Pending (3)"`. Query must return one row, one numeric column.

### Section type catalog

| Type | Query returns | Renders as |
|------|-------------|------------|
| `table` | rows | Paginated table → clickable rows → detail pages → action buttons |
| `stats` | single row | Row of metric cards (label + big number) |
| `progress` | multiple rows | Row of progress bars (label + bar + subtitle) |
| `text` | none | Markdown block (headings, bold, italic, lists) |
| `chart` | rows | Inline SVG bar or donut chart |
| `gallery` | rows | Image card grid with title + metadata |
| `accordion` | none | Collapsible container wrapping child sections |

### Stats section

```json
{
  "type": "stats",
  "query": "SELECT count(*) as total, sum(case when status='pending' then 1 else 0 end) as pending FROM requests WHERE email = :user",
  "items": [
    { "label": "Total", "column": "total", "valueColor": "neutral" },
    { "label": "Pending", "column": "pending", "format": "number", "color": "#f59e0b", "href": "?tab=pending" }
  ]
}
```

Formats: `number` (comma-separated), `currency` ($X,XXX.XX), `currency-whole` ($X,XXX — no cents), `currency-short` ($12.5K / $1.2M), `percent` (XX%). Stats default to whole dollars for `currency`. Values that overflow stat cards auto-abbreviate to K/M.

`color` sets the top border; `valueColor` controls the number color: `"match"` (inherit border color — default when `color` is set), `"neutral"` (dark text), or a hex string. Omitting both uses workspace accentColor.

`href` makes the stat card a clickable link — use `"?tab=<id>"` to navigate to a tab, or any URL.

### Progress section

```json
{
  "type": "progress",
  "query": "SELECT type, used, annual, (annual - used) as remaining FROM pto_balances WHERE email = :user",
  "labelColumn": "type",
  "valueColumn": "used",
  "maxColumn": "annual",
  "subtitleTemplate": "{{remaining}} hrs remaining"
}
```

### Text section

```json
{
  "type": "text",
  "content": "## Welcome\nLatest updates from the team.\n\n- **Policy update**: new PTO rules effective June 1\n- Holiday schedule posted"
}
```

Supports: `# ## ### headings`, `**bold**`, `*italic*`, `- lists`, blank-line paragraph breaks.

### Chart section

```json
{
  "type": "chart",
  "query": "SELECT status as label, count(*) as value FROM runs GROUP BY status",
  "chartType": "donut",
  "title": "Status Breakdown",
  "colors": { "complete": "#16a34a", "error": "#ef4444" }
}
```

`chartType`: `"bar"` (horizontal bars, max 20) or `"donut"` (circle segments, max 8). `labelColumn` and `valueColumn` default to `"label"` and `"value"` — alias your SQL columns to match. `colors` maps label values to hex colors (unmatched labels use the default palette).

### Gallery section

```json
{
  "type": "gallery",
  "query": "SELECT id, photo_url, name, role FROM team ORDER BY name",
  "imageColumn": "photo_url",
  "titleColumn": "name",
  "fields": [{ "key": "role", "label": "Role" }],
  "columns": 4
}
```

### Accordion section

```json
{
  "type": "accordion",
  "label": "Historical Requests",
  "open": false,
  "sections": [
    { "type": "table", "query": "...", "columns": [...] }
  ]
}
```

Wraps child sections in a collapsible `<details>` element. Sections inside accordions work identically — they can be any type including nested accordions.

### Table section (full)

```json
{
  "type": "table",
  "query": "SELECT id, title, status, created_at FROM requests WHERE email = :user ORDER BY created_at DESC",
  "primaryKey": "id",
  "pageSize": 25,
  "columns": [
    { "key": "title", "label": "Title" },
    { "key": "status", "label": "Status", "badge": true },
    { "key": "created_at", "label": "Created", "format": "datetime", "dateFormat": "short" }
  ],
  "detail": {
    "title": "{{title}}",
    "fields": [
      { "key": "title", "label": "Title" },
      { "key": "status", "label": "Status", "badge": true },
      { "key": "created_at", "label": "Submitted", "format": "datetime" }
    ]
  },
  "actions": [
    {
      "name": "approve",
      "label": "Approve",
      "workflow": "handle-approval",
      "style": "success",
      "showWhen": { "field": "status", "op": "eq", "value": "pending" },
      "afterMessage": "Approved on {{timestamp}}",
      "afterActions": [
        { "label": "Revoke", "action": "revoke", "style": "danger" }
      ]
    },
    {
      "name": "deny",
      "label": "Deny",
      "workflow": "handle-approval",
      "style": "danger",
      "showWhen": { "field": "status", "op": "eq", "value": "pending" },
      "confirm": "Are you sure you want to deny this request?"
    }
  ],
  "emptyMessage": "No records found."
}
```

**Action button styles**: `"success"` (green), `"danger"` (red), `"warning"` (amber), `"primary"` (accent), `"default"` (gray). Add `"color": "#hex"` for a custom color with working hover. Use `"success"`/`"danger"` for approve/deny instead of `"primary"` to avoid both buttons inheriting accentColor.

**After-action behavior**: Actions are optimistic — the button is replaced immediately with a status message. Configure with:
- `"afterMessage"` — custom status text. Use `{{timestamp}}` for the date/time. Default: "✓ {label} · {timestamp}".
- `"afterColor"` — color for the status message text (hex). Default: workspace accent color. Use `"#16a34a"` for approve, `"#dc2626"` for deny.
- `"afterActions"` — follow-up buttons shown after the action fires. Each has `label`, `action` (sent as `ctx.params.action`), and optional `style`. Fires the same workflow. Omit for no follow-up buttons.
- `"confirm"` — shows a confirmation dialog before firing. Good for destructive actions.

**Badge colors**: `"badge": true` uses built-in status colors (pending=yellow, approved=green, etc.). For non-status values, add `"badgeColors": { "PTO": "#3b82f6", "Sick": "#ef4444" }` — custom map checked first, then built-in fallback.

**Timeline playback**: Action buttons can trigger scripted visual sequences instead of workflows — use `"timeline"` (array) instead of `"workflow"` (string). Purely client-side, no server round-trips. Great for client demos and presentations.

```json
{
  "name": "send-reminder",
  "label": "Send Reminder",
  "style": "primary",
  "timeline": [
    { "delay": 1, "event": "toast", "message": "AI drafting reminder email..." },
    { "delay": 3, "event": "preview", "channel": "email", "to": "Mr. Davis", "subject": "Payment Reminder", "body": "Hi Mr. Davis,\n\nThis is a friendly reminder..." },
    { "delay": 5, "event": "toast", "message": "Email sent to Mr. Davis" },
    { "delay": 7, "event": "update", "row": "inv-001", "field": "status", "value": "reminded" }
  ]
}
```

Timeline event types:
- `toast` — notification popup (top-right, auto-dismiss 4s, stacks). Fields: `message`.
- `preview` — email/SMS preview card (slides in from right). Fields: `channel` (email/sms), `to`, `subject`, `body`.
- `stream` — character-by-character text reveal into a target element. Fields: `target` (CSS selector), `text`.
- `update` — change a table cell value with highlight flash. Fields: `row` (data-row-id), `field` (column header text), `value`.
- `highlight` — pulse-highlight a table row or action button with a badge. Fields: `row` (data-row-id) for rows, `action` (action name) for buttons, `message` (badge text). Row highlights use gold; button highlights inherit the button's color. Commonly used with `autoplay` to guide users on page load.

Each event has `delay` in seconds from the trigger moment (not cumulative). Button is disabled during playback.

**Autoplay**: Add `"autoplay"` to the portal config (same event array) — fires once on page load. Use for AI summary streams on dashboards:
```json
{
  "type": "portal",
  "title": "Weekly Report",
  "autoplay": [
    { "delay": 1, "event": "stream", "target": "#ai-summary", "text": "This week: revenue up 12%..." },
    { "delay": 10, "event": "toast", "message": "Report auto-delivered Monday at 7am" }
  ],
  "tabs": [...]
}
```

**Per-surface branding**: Add `"branding": { "logoSquare": "files/logo.png", "accentColor": "#hex" }` to override workspace branding for this portal. Surface values take precedence; workspace branding from `mug.json` is the fallback.

**Embed mode**: Append `?embed=true` to any surface URL to strip header chrome (logo, session info, logout, breadcrumbs) for iframe embedding. Content (title, tabs, sections, actions) remains. CSP allows framing from `mug.work` and `*.mug.work`.

## Step 4 — Write action handler workflows (if needed)

Actions trigger workflows. The workflow receives `{ action, ...rowData, _verified_email, _surface, _workspace }`.

```typescript
import { workflow } from "@mugwork/mug";

workflow("handle-approval", async (ctx) => {
  const params = ctx.params as Record<string, string>;
  const status = params.action === "approve" ? "approved" : "denied";
  await ctx.exec("UPDATE requests SET status = ? WHERE id = ?", [status, params.id]);
  return { id: params.id, status };
});
```

Workflows in `workflows/` are auto-discovered by `mug deploy` — no import needed.

## Step 5 — Test locally

New portals are picked up automatically by the running dev server — no restart needed.

```bash
mug dev                                    # start dev server (if not already running)
open http://localhost:8787/<portal-name>
```

Use the "View As" banner to test as different users. Tab switching works via `?tab=<tabId>`.

## Step 6 — Validate

```bash
mug portal list              # show portal surfaces and URLs
```

---

## Design guidance

**Tab structure**: Use tabs when a portal serves multiple concerns (time off + pay + company news). Single-concern portals use one tab (tab bar hidden).

**Section ordering**: Put summary sections (stats, progress) above detail sections (table). Text sections work as headers or announcements. Charts provide visual context.

**Accordion usage**: Wrap historical or secondary data in accordions to keep the main view clean. Good for "past requests" below "current requests".

**Access modes**:
- `public` — anyone can view (dashboards, leaderboards)
- `identify` — anyone can access after verifying email (customer self-service)
- `auth` — only users in a database table (employee portals, manager tools)

**Query binding**: use `:user` for the session email/phone. With `auth` mode, use `:auth.column` for any column from the user's auth table row (e.g., `:auth.department`, `:auth.id`, `:auth.role`).

**Breadcrumbs**: When portal links point to other surfaces (forms, other portals), add `?from=` and `?fromLabel=` query params so the target surface shows a "Back" breadcrumb link. Example: `"/request-form?from=/employee-portal&fromLabel=Back to Portal"`. When the target surface is opened directly (no `?from=`), no breadcrumb appears.

**Home screen**: The workspace home screen (`subdomain.mug.work/`) is configured via `surfaces/_home.json` — not a portal, but uses a similar JSON config with groups, buttons, and cards. See `.mug/docs/api.md` for the full schema.

**Debugging**: Portal query errors appear in the browser console (`console.error("[mug]", ...)`). If a section shows empty when it shouldn't, open Chrome DevTools → Console and look for `[mug]` errors. Common causes: missing table (redeploy to auto-create), typo in column name, or SQL syntax error. The portal renders empty sections gracefully instead of failing — the console is where you find out why.

For form creation, see the `/form` skill. For complex workflows, see the `/workflow` skill. For email notifications, see the `/notify` skill.
