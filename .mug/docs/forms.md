# Forms — Full API Reference

Forms collect data from end users. Create a JSON config file in `surfaces/<name>.json` — the form is live immediately in `mug dev` and deploys automatically with `mug deploy`. For forms that need to be generated dynamically at runtime, use `ctx.collect()` (see [Dynamic Forms](#dynamic-forms-ctxcollect) below).

For a guided walkthrough, use the `/form` skill. For the full `ctx.params` shape (including special fields like `_verified_email` and file upload URLs), see [api.md — ctx.params](api.md#ctxparams).

## Static form config (recommended)

Create `surfaces/<name>.json`:

```json
{
  "type": "form",
  "title": "Contact Us",
  "description": "We'll get back to you within 24 hours.",
  "submitText": "Send Message",
  "workflow": "handle-contact",
  "access": { "mode": "public" },
  "fields": [
    { "name": "name", "label": "Your Name", "type": "text", "required": true },
    { "name": "email", "label": "Email", "type": "email", "required": true },
    { "name": "message", "label": "Message", "type": "textarea", "rows": 5 }
  ]
}
```

### Config fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"form"` | yes | Surface type |
| `title` | string | yes | Form heading |
| `description` | string | no | Subtitle below heading |
| `submitText` | string | no | Submit button label (default: "Submit") |
| `workflow` | string | yes | Handler workflow name |
| `access` | FormAccess | no | Access control (default: public) |
| `fields` | FormField[] | * | Single-page form fields |
| `pages` | FormPage[] | * | Multi-page form (overrides `fields`) |
| `editMode` | EditMode | no | Pre-fill from existing records |

\* One of `fields` or `pages` is required.

### Multi-page form

```json
{
  "type": "form",
  "title": "Client Onboarding",
  "workflow": "handle-onboarding",
  "pages": [
    {
      "id": "company",
      "title": "Company Info",
      "fields": [
        { "name": "company", "label": "Company Name", "type": "text", "required": true },
        { "name": "industry", "label": "Industry", "type": "select", "options": [
          { "label": "Construction", "value": "construction" },
          { "label": "HVAC", "value": "hvac" },
          { "label": "Property Management", "value": "property" }
        ]}
      ]
    },
    {
      "id": "contact",
      "title": "Primary Contact",
      "fields": [
        { "name": "contact_name", "label": "Name", "type": "text", "required": true },
        { "name": "contact_email", "label": "Email", "type": "email", "required": true },
        { "name": "contact_phone", "label": "Phone", "type": "phone" }
      ]
    }
  ]
}
```

## Field types

All fields share a base interface:

```typescript
interface BaseField {
  name: string;             // field identifier (used in submission params)
  label: string;            // display label
  required?: boolean;       // default: false
  placeholder?: string;     // placeholder text
  showWhen?: Condition[];   // conditional visibility
  default?: string | number | boolean;  // static default value
  prefill?: FieldPrefill;   // auto-fill from auth row, URL param, or database
  locked?: boolean;         // read-only in UI + server-enforced
  helpText?: string;        // hint text displayed below the label
  validate?: ValidationRule[];  // custom validation rules with error messages
}

interface ValidationRule {
  rule: "min" | "max" | "minLength" | "maxLength" | "pattern";
  value: number | string;   // the constraint value
  message: string;          // user-facing error message shown on failure
}
```

**Field names must be unique across the entire form** — including across pages and conditional (`showWhen`) fields. Duplicate names cause silent data loss: the form submits the wrong field's value. `mug form validate` and `mug dev` catch duplicates at config load time.

Both `helpText` and `validate` support `{{column}}` template syntax — values are resolved from the authenticated user's database row at render time. This lets you pipe dynamic limits and context into forms:

```typescript
{
  name: "hours", type: "number", label: "Hours Requested", required: true,
  helpText: "You have {{available_pto_hours}} hours available",
  validate: [
    { rule: "min", value: 0.5, message: "Must request at least 30 minutes" },
    { rule: "max", value: "{{available_pto_hours}}", message: "Cannot exceed your {{available_pto_hours}} available hours" }
  ]
}
```

Template values that resolve to numbers (like `{{available_pto_hours}}` → `16`) are automatically coerced for numeric comparisons in `min`/`max` rules. Unresolved templates (column not found in auth row) are left as-is.

### text

Single-line text input. Also used for email and phone with built-in validation.

```typescript
interface TextField extends BaseField {
  type: "text" | "email" | "phone";
  pattern?: string;         // regex pattern for validation
}
```

```typescript
{ name: "name", label: "Full Name", type: "text", required: true }
{ name: "email", label: "Email Address", type: "email", required: true }
{ name: "phone", label: "Phone Number", type: "phone", placeholder: "+1 (555) 000-0000" }
{ name: "zip", label: "ZIP Code", type: "text", pattern: "^\\d{5}(-\\d{4})?$" }
```

### number

Numeric input with optional range constraints.

```typescript
interface NumberField extends BaseField {
  type: "number";
  min?: number;
  max?: number;
  step?: number;            // increment (e.g., 0.01 for currency)
}
```

```typescript
{ name: "quantity", label: "Quantity", type: "number", min: 1, max: 100 }
{ name: "price", label: "Price", type: "number", min: 0, step: 0.01 }
```

### select / multiselect

Dropdown or multi-choice selection.

```typescript
interface SelectField extends BaseField {
  type: "select" | "multiselect";
  options: { label: string; value: string }[];
}
```

```typescript
{ name: "priority", label: "Priority", type: "select", options: [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
]}

{ name: "services", label: "Services Needed", type: "multiselect", options: [
  { label: "Plumbing", value: "plumbing" },
  { label: "Electrical", value: "electrical" },
  { label: "HVAC", value: "hvac" },
]}
```

### date

Date picker with optional min/max constraints.

```typescript
interface DateField extends BaseField {
  type: "date";
  min?: string;    // ISO date string (e.g., "2024-01-01")
  max?: string;
}
```

```typescript
{ name: "preferred_date", label: "Preferred Date", type: "date", min: "2024-01-01" }
```

### textarea

Multi-line text input.

```typescript
interface TextareaField extends BaseField {
  type: "textarea";
  rows?: number;         // visible rows (default: 3)
  maxLength?: number;    // character limit
}
```

```typescript
{ name: "notes", label: "Additional Notes", type: "textarea", rows: 5, maxLength: 2000 }
```

### file

File upload field.

```typescript
interface FileField extends BaseField {
  type: "file";
  accept?: string;       // MIME types (e.g., "image/*,.pdf")
  maxSizeMb?: number;    // max file size in MB
}
```

```typescript
{ name: "photo", label: "Upload Photo", type: "file", accept: "image/*", maxSizeMb: 10 }
{ name: "document", label: "Supporting Document", type: "file", accept: ".pdf,.doc,.docx", maxSizeMb: 25 }
```

**In the handler workflow**, file fields arrive as R2 URL strings in `ctx.params`:
```typescript
workflow("handle-request", async (ctx) => {
  const photoUrl = ctx.params.photo as string;  // "https://r2.mug.work/workspace/uploads/abc123.jpg"
  await ctx.exec("INSERT INTO requests (photo_url) VALUES (?)", [photoUrl]);
});
```

### calculated

Display-only field that computes a value from other fields. Not submitted.

```typescript
interface CalculatedField {
  name: string;
  type: "calculated";
  label: string;
  expression: string;      // JavaScript expression referencing other field names
  format?: "number" | "currency" | "percent";
  showWhen?: Condition[];
}
```

```typescript
{ name: "total", type: "calculated", label: "Total", expression: "quantity * price", format: "currency" }
{ name: "tax", type: "calculated", label: "Tax (8%)", expression: "quantity * price * 0.08", format: "currency" }
{ name: "grand_total", type: "calculated", label: "Grand Total", expression: "quantity * price * 1.08", format: "currency" }
```

### hidden

Invisible field — never rendered, always included in submission. Use for form IDs, tracking params, or auth-prefilled values the user shouldn't see.

```typescript
interface HiddenField {
  name: string;
  type: "hidden";
  default?: string | number | boolean;
  prefill?: FieldPrefill;
  locked?: boolean;
}
```

```typescript
{ name: "form_version", type: "hidden", default: "v2" }
{ name: "employee_id", type: "hidden", prefill: { source: "auth", column: "id" } }
{ name: "department", type: "hidden", prefill: { source: "url", param: "dept" } }
```

## Default values

Any field can have a `default` value — a static value pre-populated when the form loads. Defaults are the lowest priority in the fill chain: prefill > editRecord > URL param > default.

```typescript
{ name: "status", type: "hidden", default: "pending" }
{ name: "priority", type: "select", label: "Priority", default: "medium", options: [...] }
{ name: "country", type: "text", label: "Country", default: "US" }
```

For select fields, the matching option is pre-selected. For multiselect, pass comma-separated values: `default: "plumbing,hvac"`.

## Prefill

Auto-fill field values from three sources: the authenticated user's database row, URL parameters, or a related database record.

```typescript
type FieldPrefill =
  | { source: "auth"; column: string }
  | { source: "url"; param: string }
  | { source: "db"; table: string; column: string; match: { column: string; field?: string; param?: string } };
```

### Prefill from auth row

When a form uses `auth` access mode, the runtime fetches the full row from the auth table (not just checking existence). Any field can reference a column from that row:

```typescript
{ name: "employee_name", type: "text", label: "Your Name",
  prefill: { source: "auth", column: "name" }, locked: true }

{ name: "department", type: "text", label: "Department",
  prefill: { source: "auth", column: "department" }, locked: true }

{ name: "employee_id", type: "hidden",
  prefill: { source: "auth", column: "id" } }
```

Auth prefill is resolved server-side at render time — the value is already in the HTML when the page loads. Combined with `locked: true`, the user sees their name but can't change it, and the server enforces the value on submission.

### Prefill from URL parameters

Reference a URL query parameter:

```typescript
{ name: "department", type: "text", label: "Department",
  prefill: { source: "url", param: "dept" } }
// URL: https://workspace.mug.work/form-id?dept=Engineering
```

URL prefill is resolved client-side.

### Prefill from database

Fetch a value from a related table at render time:

```typescript
{ name: "manager_name", type: "text", label: "Manager",
  prefill: { source: "db", table: "departments", column: "manager_name",
    match: { column: "id", param: "dept_id" } }, locked: true }
// URL: https://workspace.mug.work/form-id?dept_id=3
// Fetches: SELECT manager_name FROM departments WHERE id = 3
```

The `match` object specifies how to find the row:
- `match.param` — match against a URL query parameter
- `match.field` — match against another field's prefill value (for chaining)

### Priority chain

When multiple sources provide a value for the same field, higher priority wins:

1. **locked + prefill source** (highest — server enforces this)
2. **prefill** (auth, URL, or DB)
3. **editRecord** (edit mode)
4. **URL parameter** (informal — any URL param matching a field name)
5. **default** (lowest)

## Locked fields

`locked: true` makes a field read-only in the UI and server-enforced on submission. The submitted value is ignored — the server uses the known value from the prefill source or default.

```typescript
{ name: "employee_name", type: "text", label: "Your Name",
  prefill: { source: "auth", column: "name" }, locked: true }
```

- Input fields render with `readonly` attribute
- Select/multiselect fields render as `disabled` (with hidden input for submission)
- Visual styling: grey background, muted text, not-allowed cursor
- **Server-side enforcement**: on submission, the handler overwrites the field value with the known source value, preventing HTML tampering

Locked fields work with any value source:
```typescript
// Locked with auth prefill — user's name from the employees table
{ name: "name", type: "text", label: "Your Name",
  prefill: { source: "auth", column: "name" }, locked: true }

// Locked with static default — always submits "v2"
{ name: "form_version", type: "hidden", default: "v2", locked: true }

// Locked with URL param — set by the link, user can't change
{ name: "referral_source", type: "text", label: "Source",
  prefill: { source: "url", param: "ref" }, locked: true }
```

## Conditional fields

Any field can be shown/hidden based on the value of another field using `showWhen`.

```typescript
interface Condition {
  field: string;                          // name of the field to check
  op: "eq" | "neq" | "in" | "gt" | "lt" | "filled" | "empty";
  value?: string | number | string[];     // comparison value
}
```

### Operators

| Operator | Meaning | Value type |
|----------|---------|------------|
| `eq` | equals | string or number |
| `neq` | not equals | string or number |
| `in` | value is one of | string[] |
| `gt` | greater than | number |
| `lt` | less than | number |
| `filled` | field has any value | (no value needed) |
| `empty` | field is empty | (no value needed) |

### Examples

```typescript
// Show "Other" text field when category is "other"
{ name: "category_other", label: "Specify", type: "text",
  showWhen: [{ field: "category", op: "eq", value: "other" }] }

// Show warranty fields for high-value orders
{ name: "warranty", label: "Add Warranty?", type: "select",
  options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
  showWhen: [{ field: "price", op: "gt", value: 1000 }] }

// Multiple conditions (AND logic — all must be true)
{ name: "rush_fee", type: "calculated", label: "Rush Fee",
  expression: "total * 0.25", format: "currency",
  showWhen: [
    { field: "priority", op: "eq", value: "high" },
    { field: "total", op: "gt", value: 500 },
  ] }
```

## Multi-page forms

### FormPage

```typescript
interface FormPage {
  id: string;               // unique page identifier
  title?: string;           // page heading
  description?: string;     // page description
  fields: FormField[];      // fields on this page
  showWhen?: Condition[];   // conditionally show/skip entire page
  nextPage?: string | {     // navigation control
    conditions: PageBranch[];
    default: string;
  };
}
```

### Linear page flow

Pages display in array order by default. No `nextPage` needed:

```typescript
pages: [
  { id: "step1", title: "Basic Info", fields: [...] },
  { id: "step2", title: "Details", fields: [...] },
  { id: "step3", title: "Confirmation", fields: [...] },
]
```

### Conditional page skipping

Skip a page based on prior answers:

```typescript
pages: [
  { id: "type", fields: [
    { name: "service_type", label: "Service Type", type: "select", options: [
      { label: "Residential", value: "residential" },
      { label: "Commercial", value: "commercial" },
    ]},
  ]},
  { id: "commercial_details", title: "Commercial Details",
    showWhen: [{ field: "service_type", op: "eq", value: "commercial" }],
    fields: [...] },
  { id: "schedule", title: "Schedule", fields: [...] },
]
```

### Branching page flow

Route to different pages based on answers:

```typescript
interface PageBranch {
  when: Condition[];
  goto: string;      // page ID to jump to
}
```

```typescript
pages: [
  {
    id: "triage",
    fields: [{ name: "urgency", label: "Urgency", type: "select", options: [
      { label: "Emergency", value: "emergency" },
      { label: "Routine", value: "routine" },
    ]}],
    nextPage: {
      conditions: [
        { when: [{ field: "urgency", op: "eq", value: "emergency" }], goto: "emergency_info" },
      ],
      default: "routine_info",
    },
  },
  { id: "emergency_info", title: "Emergency Details", fields: [...] },
  { id: "routine_info", title: "Routine Request", fields: [...] },
]
```

## Access modes

Control who can access the form.

```typescript
type FormAccess = FormAccessPublic | FormAccessIdentify | FormAccessAuth;
```

**Choosing the right mode:**

| Scenario | Mode | Why |
|----------|------|-----|
| Open form (contact us, public intake) | `public` | Anyone can submit |
| Self-service — anyone can sign up (customer request, application) | `identify` | User proves email ownership, but anyone can submit |
| Internal form — only pre-registered users (employee requests, client portals) | `auth` | User must exist in a database table |

**Rule of thumb:** if you have a table of who should access this form, use `auth`. If anyone with a valid email can submit, use `identify`.

### Public (default)

Anyone with the link can submit.

```typescript
access: { mode: "public" }
```

### Identify

Anyone can access after verifying email/phone. Good for self-service flows where you need to know who submitted but don't restrict who can submit.

```typescript
interface FormAccessIdentify {
  mode: "identify";
  method: "email" | "phone";
  sessionDuration: string;     // e.g., "24h", "7d"
}
```

```typescript
access: { mode: "identify", method: "email", sessionDuration: "24h" }
```

### Auth

Restricted to known users. Checks submitted identity against a database table before allowing access. Use for internal tools — employee forms, client-only portals, manager workflows.

```typescript
interface FormAccessAuth {
  mode: "auth";
  method: "email" | "phone";
  table: string;               // database table — must be a valid SQL identifier (letters, numbers, underscores)
  matchColumn: string;          // column name — must be a valid SQL identifier
  sessionDuration: string;
  query?: string;              // custom SQL to fetch auth row (use :identity for the user's email/phone)
}
```

```typescript
access: {
  mode: "auth",
  method: "email",
  table: "employees",
  matchColumn: "email",
  sessionDuration: "7d",
}
```

#### Auth query (computed columns)

By default, the runtime fetches `SELECT * FROM <table> WHERE <matchColumn> = ?`. Use `query` to replace this with a custom SQL statement that includes JOINs, calculations, or any computed columns. Use `:identity` as the placeholder for the authenticated user's email/phone:

```typescript
access: {
  mode: "auth",
  method: "email",
  table: "employees",
  matchColumn: "email",
  query: `SELECT e.*, r.hours_per_year - COALESCE(u.used, 0) AS available_pto
    FROM employees e
    LEFT JOIN pto_rules r ON r.employee_id = e.id
    LEFT JOIN (SELECT employee_id, SUM(hours) AS used FROM pto_requests WHERE status != 'denied' GROUP BY employee_id) u ON u.employee_id = e.id
    WHERE e.email = :identity`,
  sessionDuration: "7d",
}
```

The computed columns are available in `{{templates}}` (help text, validation messages), `prefill: { source: "auth" }`, and `ctx.params._auth_row` in workflows. Values are computed fresh on every form render — no denormalized columns or sync workflows needed. `table` and `matchColumn` are still required (used for dev-mode user dropdown and identity verification).

In dev mode (`mug dev`), `auth` surfaces show a dropdown of registered users in the View As banner. `identify` surfaces show a freeform email input. Both bypass verification.

### Auth context (auth row)

When a surface uses `auth` access mode, the runtime fetches the auth row (via `SELECT *` or the custom `query` if configured) — not just checking if the user exists. This row is available to:

- **Form fields** via `prefill: { source: "auth", column: "name" }` — auto-fill fields from the user's record
- **Handler workflows** via `ctx.params._auth_row` — the full row object from the auth table
- **Portal queries** via `:auth.column` binding — filter data by any column from the user's record (see [portals.md](portals.md))

```typescript
// In a handler workflow, access the full auth row:
workflow("handle-request", async (ctx) => {
  const authRow = ctx.params._auth_row as Record<string, string>;
  const department = authRow.department;
  const managerId = authRow.manager_id;
});
```

## Edit mode

Pre-fill form fields from existing database records. Useful for update/edit flows.

```typescript
interface EditMode {
  table: string;          // database table to read from
  recordParam: string;    // URL query param containing the record identifier
  matchColumn: string;    // column to match against the param value
}
```

```typescript
editMode: {
  table: "contacts",
  recordParam: "contact_id",
  matchColumn: "id",
}
// Form URL: https://workspace.mug.work/surfaceId?contact_id=123
// Fields are pre-filled from the contacts row where id = 123
```

## Form URLs

| Environment | URL pattern |
|-------------|-------------|
| Local dev | `http://localhost:8787/<name>` |
| Production | `https://<workspace>.mug.work/<name>` |

The filename (minus `.json`) is the surface ID used in the URL. For example, `surfaces/intake.json` is served at `/intake`.

## Branding

Forms automatically pick up workspace branding from `mug.json`:

```json
{
  "branding": {
    "logo": "assets/logo.png",
    "logoSquare": "assets/icon.png",
    "accentColor": "#1a5276"
  }
}
```

- **logo** — rectangle logo displayed in the form header above the title. Path relative to workspace root, or a URL.
- **logoSquare** — square logo variant (used as fallback if `logo` is not set). Reserved for future use in favicons and compact layouts.
- **accentColor** — hex color applied to submit buttons, focus rings, progress bar, session badge via CSS variable `--accent`, and the browser favicon.

No changes to form config or code needed — workspace branding is injected automatically. In dev, logos are served from local files and changes to `mug.json` hot-reload. On deploy, logos are uploaded to R2 and embedded in surface configs.

### Per-surface branding overrides

Add `"branding"` directly to a form's JSON config to override workspace branding for that form. Surface values take precedence; workspace values are the fallback.

```json
{
  "type": "form",
  "title": "Request Time Off",
  "branding": {
    "logoSquare": "files/company-logo.png",
    "accentColor": "#2563eb"
  }
}
```

## Breadcrumbs (cross-surface navigation)

When linking to a form from another surface (e.g., a portal link), add `?from=` and `?fromLabel=` query parameters to render a "Back" breadcrumb above the form header.

```
/request-form?from=/employee-portal&fromLabel=Back to Portal
```

| Param | Required | Description |
|-------|----------|-------------|
| `from` | yes | URL to navigate back to |
| `fromLabel` | no | Breadcrumb text (default: "Back") |

When opened directly without `?from=`, no breadcrumb appears. Breadcrumbs work on both form and portal surfaces — see [portals.md](portals.md#breadcrumbs-cross-surface-navigation).

## CLI commands

```bash
mug form init <name>       # scaffold form config + handler workflow
mug form validate [name]   # validate form configs for errors
mug form list              # list forms and their URLs
```

## Dynamic forms (ctx.collect)

For forms that need to be generated programmatically at runtime — when fields depend on database state, forms are per-user, or you need to create forms on the fly — use `ctx.collect()` inside a workflow instead of a static JSON config.

```typescript
const url = await ctx.collect({
  id: "dynamic-intake",
  title: "Intake Form",
  workflow: "handle-intake",
  access: { mode: "public" },
  fields: [
    { name: "name", type: "text", label: "Name", required: true },
  ],
});
```

`ctx.collect()` accepts the same fields as the static JSON config (title, description, submitText, workflow, access, fields/pages, editMode). The `id` field controls the surface ID in the URL — if omitted, a random 8-character ID is generated.

**Important:** Dynamic forms require running the creation workflow before the URL works. In production, deploy then run `mug run <workflow> --production`. In local dev, `ctx.collect()` does not persist the config — use static JSON configs for development.

## Complete example

Service request form with conditional fields, multi-page, and authenticated access:

**Form config** (`surfaces/service-request.json`):
```json
{
  "type": "form",
  "title": "Service Request",
  "description": "Submit a service request and we'll schedule a technician.",
  "submitText": "Submit Request",
  "workflow": "handle-service-request",
  "access": {
    "mode": "auth",
    "method": "email",
    "table": "customers",
    "matchColumn": "email",
    "sessionDuration": "30d"
  },
  "pages": [
    {
      "id": "service",
      "title": "Service Details",
      "fields": [
        { "name": "service_type", "label": "Service Type", "type": "select", "required": true, "options": [
          { "label": "Repair", "value": "repair" },
          { "label": "Installation", "value": "installation" },
          { "label": "Maintenance", "value": "maintenance" }
        ]},
        { "name": "urgency", "label": "Urgency", "type": "select", "required": true, "options": [
          { "label": "Emergency (24hr)", "value": "emergency" },
          { "label": "Urgent (48hr)", "value": "urgent" },
          { "label": "Standard (1 week)", "value": "standard" }
        ]},
        { "name": "description", "label": "Describe the issue", "type": "textarea", "rows": 4, "required": true },
        { "name": "photos", "label": "Photos (optional)", "type": "file", "accept": "image/*", "maxSizeMb": 10 }
      ]
    },
    {
      "id": "equipment",
      "title": "Equipment Info",
      "showWhen": [{ "field": "service_type", "op": "in", "value": ["repair", "maintenance"] }],
      "fields": [
        { "name": "equipment_type", "label": "Equipment Type", "type": "text" },
        { "name": "model_number", "label": "Model Number", "type": "text" },
        { "name": "install_year", "label": "Year Installed", "type": "number", "min": 1990, "max": 2026 }
      ]
    },
    {
      "id": "schedule",
      "title": "Scheduling",
      "fields": [
        { "name": "preferred_date", "label": "Preferred Date", "type": "date" },
        { "name": "preferred_time", "label": "Preferred Time", "type": "select", "options": [
          { "label": "Morning (8am-12pm)", "value": "morning" },
          { "label": "Afternoon (12pm-5pm)", "value": "afternoon" },
          { "label": "Any time", "value": "any" }
        ]},
        { "name": "access_notes", "label": "Access Instructions", "type": "textarea", "rows": 2,
          "placeholder": "Gate code, parking instructions, etc." }
      ]
    }
  ]
}
```
