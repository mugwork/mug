# Portals — Full API Reference

Portals display workspace data as tabbed, section-based pages. Each tab contains typed sections (table, stats, progress, text, chart, gallery) with optional accordion containers. Config-driven JSON — no TypeScript code needed for the surface itself. Table sections support detail pages and action buttons that trigger workflows.

For a guided walkthrough, use the `/portal` skill. For the full `ctx.params` shape when portal actions trigger workflows, see [api.md — ctx.params](api.md#ctxparams).

## PortalConfig

Portal configs live at `surfaces/<name>.json`. The `type` field must be `"portal"`.

```typescript
interface PortalConfig {
  type: "portal";
  title: string;                // page heading
  description?: string;         // subtitle below heading
  access: FormAccess;           // who can view (same as forms)
  database?: string;            // source name for scoped queries (default: unified workspace database — cross-source queries work automatically)
  sections?: PortalSection[];   // sections rendered above the tab bar, visible on all tabs
  tabs: PortalTab[];            // one or more tabs
  branding?: BrandingConfig;    // optional per-surface override; falls back to mug.json workspace branding
}
```

### Per-surface branding

Override workspace branding for individual surfaces. Surface branding takes precedence; workspace branding (from `mug.json`) is the fallback for any field not specified.

```json
{
  "type": "portal",
  "title": "Team Requests — Renwick Builders",
  "branding": {
    "logoSquare": "files/renwick-logo.png",
    "accentColor": "#2563eb"
  }
}
```

`logo` (rectangle), `logoSquare` (square), and `accentColor` are all optional. Logo paths are relative to the workspace root — files in `files/` work directly.

### Top-level sections

Sections defined at the config root render **above the tab bar** and stay visible when switching tabs. Useful for stats cards or summary content that applies across all tabs — avoids duplicating sections in every tab.

```json
{
  "type": "portal",
  "title": "Approvals",
  "sections": [
    {
      "type": "stats",
      "query": "SELECT count(*) filter (where status='pending') as pending, count(*) filter (where status='approved') as approved, count(*) filter (where status='denied') as denied FROM requests WHERE approver_email = :user",
      "items": [
        { "label": "Pending", "column": "pending", "color": "#f59e0b", "href": "?tab=pending" },
        { "label": "Approved", "column": "approved", "color": "#16a34a", "href": "?tab=approved" },
        { "label": "Denied", "column": "denied", "color": "#ef4444", "href": "?tab=denied" }
      ]
    }
  ],
  "tabs": [...]
}
```

## PortalTab

Each tab has an ID, a label for the tab bar, and an array of sections.

```typescript
interface PortalTab {
  id: string;                   // URL-safe identifier (e.g., "timeoff")
  label: string;                // tab bar display text
  color?: string;               // tab text + underline color (hex or CSS color)
  countQuery?: string;          // SQL query returning a single number — shown as badge: "Label (N)"
  sections: PortalSection[];    // sections rendered in order
  links?: PortalLink[];         // nav links shown when this tab is active
}
```

Single-tab portals don't show a tab bar — the sections render directly.

### Tab colors

Set `color` on a tab to give it a colored text and active underline instead of the default accent color. Useful for status-based tabs where color conveys meaning:

```json
"tabs": [
  { "id": "pending", "label": "Pending", "color": "#f59e0b", ... },
  { "id": "approved", "label": "Approved", "color": "#16a34a", ... },
  { "id": "denied", "label": "Denied", "color": "#ef4444", ... }
]
```

### Tab count badges

Set `countQuery` on a tab to show a dynamic count badge next to the label. The query must return a single row with a single numeric column. The count updates on every page load.

```json
{
  "id": "pending",
  "label": "Pending",
  "color": "#f59e0b",
  "countQuery": "SELECT count(*) FROM requests WHERE approver_email = :user AND status = 'pending'",
  "sections": [...]
}
```

Renders as: **Pending (3)** — with a pill badge that inherits the tab's color.

## Section Types

Sections are a discriminated union on the `type` field:

### table

Paginated table with clickable rows → detail pages → action buttons. This is the main data display section.

```typescript
interface TableSection {
  type: "table";
  query: string;                // SQL SELECT query — use :user for session identity. Must start with SELECT or WITH, no semicolons.
  primaryKey?: string;          // column for row identity (default: "id") — must be a valid SQL identifier
  pageSize?: number;            // rows per page (default: 25)
  columns: PortalColumn[];      // list view table columns
  detail?: {
    title?: string;             // template with {{column}} interpolation
    fields: PortalField[];      // detail page fields
  };
  actions?: PortalAction[];     // buttons on detail page
  emptyMessage?: string;        // shown when query returns 0 rows
}
```

### stats

Row of metric cards from a single-row query result.

```typescript
interface StatsSection {
  type: "stats";
  query: string;                // should return a single row
  items: {
    label: string;              // card heading
    column: string;             // column name from query result
    format?: "number" | "currency" | "currency-whole" | "currency-short" | "percent";
    color?: string;             // top border accent color (hex or CSS color)
    valueColor?: string;        // color for the number — see below
    href?: string;              // makes the card a clickable link
  }[];
}
```

### Clickable stat cards (`href`)

Set `href` on a stat item to make the entire card a clickable link. The card gets a hover effect (border darkens, subtle shadow). Useful for linking stats to corresponding tabs:

```json
"items": [
  { "label": "Pending", "column": "pending", "color": "#f59e0b", "href": "?tab=pending" },
  { "label": "Approved", "column": "approved", "color": "#16a34a", "href": "?tab=approved" }
]
```

Any valid URL works — relative paths, `?tab=` for tab navigation, or external links.

**`valueColor` options:**

| Value | Effect |
|-------|--------|
| `"#hex"` | Explicit color for the number |
| `"match"` | Inherit from the item's `color` (border color) |
| `"neutral"` | Default dark text (`#1a1a1a`) — no accent |
| omitted + `color` set | Implicit `"match"` — number matches border color |
| omitted + no `color` | Inherits workspace `accentColor` (default behavior) |

Example — yellow border + yellow number for "Pending", green for "Approved", neutral for "Total":
```json
"items": [
  { "label": "Total", "column": "total", "valueColor": "neutral" },
  { "label": "Pending", "column": "pending", "color": "#f59e0b" },
  { "label": "Approved", "column": "approved", "color": "#16a34a" }
]
```

### progress

Row of progress bars, one per result row.

```typescript
interface ProgressSection {
  type: "progress";
  query: string;                // each row = one progress bar
  labelColumn: string;          // column for bar label
  valueColumn: string;          // column for current value
  maxColumn: string;            // column for max value
  subtitleTemplate?: string;    // template with {{column}} interpolation
  color?: string;               // bar fill color (default: accent color)
  colorColumn?: string;         // column containing hex color per row (overrides color)
  colorThresholds?: Array<{     // threshold-based coloring by percentage (overrides color)
    percent: number;            // upper bound percentage (inclusive)
    color: string;              // hex color when pct <= this threshold
  }>;
}
```

Color priority: `colorColumn` > `colorThresholds` > `color` > accent default.

**colorThresholds example** — green under 50%, yellow 50–80%, red above:
```json
{
  "type": "progress",
  "query": "SELECT type, used, max FROM budgets",
  "labelColumn": "type", "valueColumn": "used", "maxColumn": "max",
  "colorThresholds": [
    { "percent": 50, "color": "#10b981" },
    { "percent": 80, "color": "#f59e0b" },
    { "percent": 100, "color": "#ef4444" }
  ]
}
```

**colorColumn example** — query computes color per row:
```json
{
  "type": "progress",
  "query": "SELECT type, used, max, CASE WHEN used*1.0/max > 0.8 THEN '#ef4444' WHEN used*1.0/max > 0.5 THEN '#f59e0b' ELSE '#10b981' END as bar_color FROM budgets",
  "labelColumn": "type", "valueColumn": "used", "maxColumn": "max",
  "colorColumn": "bar_color"
}
```

### text

Static markdown content block — no query needed.

```typescript
interface TextSection {
  type: "text";
  content: string;              // markdown: # headings, **bold**, *italic*, - lists
}
```

### chart

Inline SVG chart — no charting library required.

```typescript
interface ChartSection {
  type: "chart";
  query: string;
  chartType: "bar" | "donut";
  labelColumn?: string;         // column for labels (default: "label")
  valueColumn?: string;         // column for values (default: "value")
  title?: string;               // chart heading
  color?: string;               // bar color (bar chart only)
  colorColumn?: string;         // per-bar color from data
  colors?: Record<string, string>;  // per-label color map (label value → hex color)
}
```

- **Bar chart**: horizontal bars sorted by value. Max 20 bars.
- **Donut chart**: circle segments with legend. Max 8 segments.
- Excess items truncated with "+N others" note.
- **`labelColumn`/`valueColumn`**: default to `"label"` and `"value"` — alias your SQL columns to match and you can omit these.
- **`colors`**: map label values to hex colors. Unmatched labels use the palette. Example: `"colors": { "complete": "#16a34a", "error": "#ef4444" }`.

### gallery

Image card grid.

```typescript
interface GallerySection {
  type: "gallery";
  query: string;
  imageColumn: string;          // column containing image URL
  titleColumn?: string;         // column for card title
  fields?: PortalField[];       // additional fields below title
  columns?: number;             // cards per row (default: 3)
}
```

### accordion

Collapsible container that wraps other sections. Uses native `<details>`/`<summary>` — no JavaScript.

```typescript
interface AccordionSection {
  type: "accordion";
  label: string;                // clickable summary text
  open?: boolean;               // start expanded (default: false)
  sections: PortalSection[];    // child sections (recursive)
}
```

## PortalColumn

Defines a column in a table section's list view.

```typescript
interface PortalColumn {
  key: string;                  // column name from query result — must be a valid SQL identifier (letters, numbers, underscores)
  label: string;                // display header text
  format?: "date" | "datetime" | "currency" | "currency-whole" | "currency-short" | "number" | "percent";
  dateFormat?: "short";         // compact date rendering (M/D/YY, h:mm AM)
  badge?: boolean;              // render as colored status badge
  badgeColors?: Record<string, string>;  // custom badge color map
}
```

### Format examples

| Format | dateFormat | Input | Output (table) | Output (stat) |
|--------|-----------|-------|--------|--------|
| `date` | (none) | `2026-05-15` | May 15, 2026 | — |
| `date` | `"short"` | `2026-05-15` | 5/15/26 | — |
| `datetime` | (none) | `2026-05-15T15:30:00` | May 15, 2026, 3:30 PM | — |
| `datetime` | `"short"` | `2026-05-15T15:30:00` | 5/15/26, 3:30 PM | — |
| `currency` | — | `1234.5` | $1,234.50 | $1,235 |
| `currency-whole` | — | `1234.5` | $1,235 | $1,235 |
| `currency-short` | — | `125000` | $125K | $125K |
| `number` | — | `1234` | 1,234 | 1,234 |
| `percent` | — | `85.3` | 85.3% | 85.3% |
| (none) | — | any | raw string value | raw string value |

Stats use whole dollars by default for `currency`. Values that overflow stat card width auto-abbreviate to K/M.

All `date` and `datetime` values render in the workspace timezone (`settings.timezone` in mug.json, auto-detected at `mug init`). To override for a specific surface, add `"timezone": "America/New_York"` to the surface JSON root.

## PortalField

Defines a field in a table section's detail view. Same as PortalColumn plus `multiline` format.

```typescript
interface PortalField {
  key: string;
  label: string;
  format?: "date" | "datetime" | "currency" | "currency-whole" | "currency-short" | "number" | "percent" | "multiline";
  badge?: boolean;
  badgeColors?: Record<string, string>;  // custom badge color map
}
```

## PortalAction

Button on a table section's detail page that triggers a workflow.

```typescript
interface PortalAction {
  name: string;                 // action identifier — sent as params.action to workflow
  label: string;                // button text
  workflow: string;             // workflow name to trigger
  style?: "primary" | "danger" | "success" | "warning" | "default";
  color?: string;               // explicit hex override (overrides style color, hover still works)
  showWhen?: Condition;         // show only when row data matches
  confirm?: string;             // confirmation dialog text — shown before firing
  afterMessage?: string;        // status text after action fires — {{timestamp}} replaced with local date/time
  afterColor?: string;          // color for the after-action status message (default: accent color)
  afterActions?: {              // follow-up buttons shown after action fires
    label: string;              // button text
    action: string;             // sent as params.action to the same workflow
    style?: string;             // button style (same options as PortalAction.style)
  }[];
}
```

**Button styles:**

| Style | Color | Use case |
|-------|-------|----------|
| `"primary"` | Workspace accent color | Main CTA |
| `"success"` | Green (`#16a34a`) | Approve, confirm, complete |
| `"warning"` | Amber (`#d97706`) | Caution, escalate |
| `"danger"` | Red (`#dc2626`) | Deny, delete, reject |
| `"default"` | Gray | Secondary actions |

The `color` property overrides the style's background with any hex color. Hover darkening still works.

**Optimistic behavior** — action buttons are replaced immediately with a status message. On backend error, original buttons restore. Default message: "✓ {label} · {timestamp}". Customize with `afterMessage` (use `{{timestamp}}` placeholder). Add `afterActions` for follow-up buttons (e.g., undo/revoke).

**Approve/deny pattern** — use `"success"` and `"danger"` instead of `"primary"` to avoid both buttons inheriting accentColor. Use `afterColor` to match the status message to the action:
```json
"actions": [
  {
    "name": "approve", "label": "Approve", "workflow": "handle-approval", "style": "success",
    "showWhen": { "field": "status", "op": "eq", "value": "pending" },
    "afterMessage": "Approved on {{timestamp}}", "afterColor": "#16a34a",
    "afterActions": [{ "label": "Revoke", "action": "revoke", "style": "danger" }]
  },
  {
    "name": "deny", "label": "Deny", "workflow": "handle-approval", "style": "danger",
    "showWhen": { "field": "status", "op": "eq", "value": "pending" },
    "confirm": "Deny this request?",
    "afterMessage": "Denied on {{timestamp}}", "afterColor": "#dc2626"
  }
]
```

### Action data flow

When a user clicks an action button, the workflow receives:

```typescript
{
  action: "approve",           // the action name
  id: 123,                     // all row data fields
  employee_name: "John",
  status: "pending",
  _verified_email: "manager@example.com",
  _surface: "approvals",
  _workspace: "my-workspace",
}
```

### showWhen condition

Same condition format as form field conditionals:

```typescript
interface Condition {
  field: string;
  op: "eq" | "neq" | "in" | "gt" | "lt" | "filled" | "empty";
  value?: string | number | string[];
}
```

## Timeline Playback

Action buttons can trigger scripted visual sequences instead of real workflows. Set `"timeline"` (array of `TimelineEvent`) instead of `"workflow"` (string). Playback is purely client-side — no server round-trips, no workflow execution.

Use cases: client demos, presentations, marketing demos, prototyping workflows before they're built.

### TimelineEvent

```typescript
interface TimelineEvent {
  delay: number;           // seconds from trigger (not cumulative)
  event: "toast" | "preview" | "stream" | "update" | "highlight";
  message?: string;        // toast: notification text; highlight: badge text
  channel?: "email" | "sms"; // preview: message channel
  to?: string;             // preview: recipient display name
  subject?: string;        // preview: email subject line
  body?: string;           // preview: message body (supports \n)
  target?: string;         // stream: CSS selector for target element
  text?: string;           // stream: text to reveal char-by-char
  row?: string;            // update/highlight: data-row-id of the table row
  action?: string;         // highlight: action name (targets button on detail page)
  field?: string;          // update: column header text to match
  value?: string;          // update: new cell value
}
```

### Event types

| Event | Behavior | Mobile |
|---|---|---|
| `toast` | Popup top-right, auto-dismiss 4s, stacks vertically | Bottom banner, full-width |
| `preview` | Email/SMS card slides in from right | Full-width bottom sheet |
| `stream` | Char-by-char text reveal (~30ms/char) with blinking cursor | Same |
| `update` | Swap table cell value, yellow flash highlight | Same |
| `highlight` | Pulse-highlight a row or button with gold glow + badge with pointer icon. Row: `row` field targets `data-row-id`. Button: `action` field targets `data-action`. `message` shows as a badge. Row uses gold; button inherits its own color. | Same |

### Example: action button with timeline

```json
{
  "name": "send-reminder",
  "label": "Send Reminder",
  "style": "primary",
  "timeline": [
    { "delay": 1, "event": "toast", "message": "AI drafting reminder email..." },
    { "delay": 3, "event": "preview", "channel": "email", "to": "Mr. Davis", "subject": "Payment Reminder", "body": "Hi Mr. Davis,\n\nThis is a friendly reminder that your invoice is past due." },
    { "delay": 5, "event": "toast", "message": "Email sent to Mr. Davis" },
    { "delay": 6, "event": "toast", "message": "SMS reminder also sent to (555) 234-5678" },
    { "delay": 8, "event": "update", "row": "inv-001", "field": "status", "value": "reminded" }
  ]
}
```

Button is disabled during playback and re-enabled after the last event fires + 2 seconds.

### Autoplay

Portal config accepts an `"autoplay"` array — same `TimelineEvent` format, fires once on page load. Use for guided demos (highlight rows/buttons on load) or AI-style summary streams on dashboards:

```json
{
  "type": "portal",
  "title": "Customers",
  "autoplay": [
    { "delay": 0, "event": "highlight", "row": "c-001", "message": "Click to see AI follow-up" },
    { "delay": 0, "event": "highlight", "action": "draft-followup", "message": "Try it" }
  ],
  "tabs": [...]
}
```

On the list page, the row highlight fires (button target doesn't exist — ignored). On the detail page, the button highlight fires (row target doesn't exist — ignored). Both events coexist safely in the same autoplay array.

The `stream` event's `target` must match an element in the page. On detail pages, stream targets from action timelines are auto-created as hidden containers and revealed when content streams in.

## Embed Mode

Append `?embed=true` to any surface URL (portal or form) to render in iframe-friendly mode:

- Strips: logo, session info, logout button, breadcrumbs
- Keeps: title, description, tabs, sections, actions, timeline playback
- CSP header: `frame-ancestors 'self' https://mug.work https://*.mug.work`
- Works with demo mode (identity set via demo config, not session cookie)
- Subdomain routing preserves the parameter: `workspace.mug.work/surface?embed=true`

Example iframe:
```html
<iframe src="https://demo.mug.work/renwick-finance?embed=true" style="width:100%;height:600px;border:none;"></iframe>
```

## PortalLink

Navigation links displayed when a tab is active.

```typescript
interface PortalLink {
  label: string;
  href: string;
}
```

## Breadcrumbs (cross-surface navigation)

When linking from one surface to another, add `?from=` and `?fromLabel=` query parameters to give the target surface a "Back" breadcrumb.

```json
{
  "links": [{ "label": "Submit Request", "href": "/request-form?from=/portal&fromLabel=Back to Portal" }]
}
```

This renders a `← Back to Portal` link above the form header. Works on both form and portal surfaces.

| Param | Required | Description |
|-------|----------|-------------|
| `from` | yes | URL to navigate back to |
| `fromLabel` | no | Breadcrumb text (default: "Back") |

When a surface is opened directly (without `?from=`), no breadcrumb appears — the surface renders as usual.

## FormAccess (shared with forms)

```typescript
interface FormAccess {
  mode: "public" | "identify" | "auth";
  method?: "email" | "phone";
  sessionDuration?: string;     // e.g., "30m", "24h", "7d"
  table?: string;               // auth mode only
  matchColumn?: string;         // auth mode only
}
```

## The `:user` parameter

Use `:user` in SQL queries to reference the current user's verified identity:

```sql
SELECT * FROM requests WHERE employee_email = :user ORDER BY created_at DESC
```

- Bound as a parameterized query value (SQL-injection safe)
- Resolves to the session's verified email or phone
- Can appear multiple times in the same query
- In dev mode, resolves to the "View As" banner identity
- **With `access: { mode: "public" }`**: resolves to empty string — queries filtering on `:user` will return zero rows. Only use `:user` with `identify` or `auth` access modes

## The `:auth.column` parameter

When a portal uses `auth` access mode, you can reference any column from the user's auth table row in SQL queries:

```sql
SELECT * FROM requests WHERE department = :auth.department ORDER BY created_at DESC
SELECT * FROM tasks WHERE assignee_id = :auth.id AND status = 'active'
```

- Requires `auth` access mode — the runtime fetches `SELECT *` from the auth table when the user authenticates
- `:auth.name`, `:auth.department`, `:auth.id` — any column from the auth table is available
- SQL-injection safe (parameterized)
- Works in table section queries, stats queries, and detail view queries
- Combine with `:user`: `WHERE email = :user AND department = :auth.department`

This enables role-based portals where different users see different data based on their attributes, not just their identity.

## Badge colors

When `badge: true` is set on a column or field, values render as colored badges.

### Built-in status colors (default)

| Color | Values (case-insensitive) |
|-------|---------------------------|
| Yellow | pending, waiting, draft, review |
| Green | approved, active, done, success, completed |
| Red | denied, rejected, failed, error |
| Gray | cancelled, expired, archived |

Unrecognized values render as gray.

### Custom badge colors (`badgeColors`)

For non-status values (categories, types, tags), use `badgeColors` to map values to hex colors. The hex is used as the text color; the background is auto-generated at 13% opacity.

```json
{ "key": "type", "label": "Type", "badge": true, "badgeColors": {
  "PTO": "#3b82f6",
  "Sick": "#ef4444",
  "Personal": "#8b5cf6"
}}
```

Lookup is case-insensitive. Values not in the custom map fall through to the built-in status colors, then to gray. `badgeColors` works on both `PortalColumn` (list view) and `PortalField` (detail view).

## URL routing

| Path | Purpose |
|------|---------|
| `/<surfaceId>` | First tab (default) |
| `/<surfaceId>?tab=<tabId>` | Specific tab |
| `/<surfaceId>/row/<rowId>?tab=<tabId>&section=<N>` | Detail page for a table section row |
| `/<surfaceId>/action` | POST endpoint for action buttons |
| `/<surfaceId>/auth` | Authentication flow (same as forms) |

Pagination uses `?page_0=2&page_1=3` — each table section in a tab has its own page parameter keyed by section index.

## Branding

Portals automatically pick up workspace branding from `mug.json`:

```json
{
  "branding": {
    "logo": "assets/logo.png",
    "logoSquare": "assets/icon.png",
    "accentColor": "#1a5276"
  }
}
```

## Choosing the right access mode

| Scenario | Mode | Why |
|----------|------|-----|
| Anyone can view (public dashboard, leaderboard) | `public` | No identity needed |
| Self-service — anyone can sign up (customer portal) | `identify` | User proves email ownership |
| Internal tool — only pre-registered users | `auth` | User must exist in a database table |

## Dev mode — "View As" banner

In `mug dev`, all surfaces display a sticky yellow banner. The banner adapts to the access mode:

- **`auth` mode**: dropdown of registered users from the auth table
- **`identify` mode**: freeform email input
- **`public` mode**: freeform email input (for testing `:user` queries)

## CLI commands

```bash
mug portal init <name>       # scaffold portal config in surfaces/<name>.json
mug portal list              # list all portal surfaces with URLs
mug dev                      # serve portals locally (with View As banner)
```

## Complete example — Employee portal with tabs

**Employee portal** (`surfaces/employee-portal.json`):
```json
{
  "type": "portal",
  "title": "Employee Portal",
  "access": { "mode": "auth", "method": "email", "table": "employees", "matchColumn": "email", "sessionDuration": "7d" },
  "tabs": [
    {
      "id": "timeoff",
      "label": "Time Off",
      "sections": [
        {
          "type": "progress",
          "query": "SELECT type, used, annual, (annual - used) as remaining FROM pto_balances WHERE email = :user",
          "labelColumn": "type",
          "valueColumn": "used",
          "maxColumn": "annual",
          "subtitleTemplate": "{{remaining}} hrs remaining"
        },
        {
          "type": "stats",
          "query": "SELECT count(*) as total, sum(case when status='pending' then 1 else 0 end) as pending FROM time_off_requests WHERE employee_email = :user",
          "items": [
            { "label": "Total Requests", "column": "total", "valueColor": "neutral" },
            { "label": "Pending", "column": "pending", "color": "#f59e0b" }
          ]
        },
        {
          "type": "table",
          "query": "SELECT id, type, start_date, end_date, hours, status FROM time_off_requests WHERE employee_email = :user ORDER BY created_at DESC",
          "columns": [
            { "key": "type", "label": "Type", "badge": true, "badgeColors": { "PTO": "#3b82f6", "Sick": "#ef4444", "Personal": "#8b5cf6" } },
            { "key": "start_date", "label": "Start", "format": "date" },
            { "key": "end_date", "label": "End", "format": "date" },
            { "key": "hours", "label": "Hours" },
            { "key": "status", "label": "Status", "badge": true }
          ],
          "detail": {
            "title": "{{type}} — {{start_date}} to {{end_date}}",
            "fields": [
              { "key": "type", "label": "Type", "badge": true, "badgeColors": { "PTO": "#3b82f6", "Sick": "#ef4444", "Personal": "#8b5cf6" } },
              { "key": "start_date", "label": "Start Date", "format": "date" },
              { "key": "end_date", "label": "End Date", "format": "date" },
              { "key": "hours", "label": "Hours" },
              { "key": "reason", "label": "Reason" },
              { "key": "status", "label": "Status", "badge": true }
            ]
          },
          "actions": [
            { "name": "cancel", "label": "Cancel Request", "workflow": "handle-cancel", "style": "danger", "showWhen": { "field": "status", "op": "eq", "value": "pending" } }
          ],
          "pageSize": 10
        }
      ],
      "links": [{ "label": "Request Time Off", "href": "/request-timeoff?from=/employee-portal&fromLabel=Back to Portal" }]
    },
    {
      "id": "company",
      "label": "Company",
      "sections": [
        {
          "type": "text",
          "content": "## Company Announcements\nLatest updates from the team."
        },
        {
          "type": "table",
          "query": "SELECT id, title, posted_at FROM announcements ORDER BY posted_at DESC",
          "columns": [
            { "key": "title", "label": "Title" },
            { "key": "posted_at", "label": "Posted", "format": "date" }
          ],
          "detail": {
            "title": "{{title}}",
            "fields": [
              { "key": "title", "label": "Title" },
              { "key": "body", "label": "Content", "format": "multiline" },
              { "key": "posted_at", "label": "Posted", "format": "datetime" }
            ]
          }
        }
      ]
    }
  ]
}
```

**Simple single-tab portal** (no tab bar shown):
```json
{
  "type": "portal",
  "title": "Pending Approvals",
  "access": { "mode": "auth", "method": "email", "table": "managers", "matchColumn": "email", "sessionDuration": "7d" },
  "tabs": [
    {
      "id": "main",
      "label": "Approvals",
      "sections": [
        {
          "type": "table",
          "query": "SELECT id, employee_name, type, start_date, end_date, hours, status FROM time_off_requests WHERE approver_email = :user AND status = 'pending' ORDER BY created_at DESC",
          "columns": [
            { "key": "employee_name", "label": "Employee" },
            { "key": "type", "label": "Type" },
            { "key": "start_date", "label": "Start", "format": "date" },
            { "key": "hours", "label": "Hours" }
          ],
          "detail": {
            "title": "{{employee_name}} — {{type}}",
            "fields": [
              { "key": "employee_name", "label": "Employee" },
              { "key": "type", "label": "Type" },
              { "key": "start_date", "label": "Start", "format": "date" },
              { "key": "end_date", "label": "End", "format": "date" },
              { "key": "hours", "label": "Hours" },
              { "key": "reason", "label": "Reason" }
            ]
          },
          "actions": [
            { "name": "approve", "label": "Approve", "workflow": "handle-approval", "style": "success" },
            { "name": "deny", "label": "Deny", "workflow": "handle-approval", "style": "danger", "confirm": "Deny this request?" }
          ],
          "emptyMessage": "No pending approvals."
        }
      ]
    }
  ]
}
```
