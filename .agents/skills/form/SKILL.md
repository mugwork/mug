---
name: form
description: Create a form that collects data from users — field types, conditionals, multi-page, access modes, file uploads, calculated fields. Scaffolds the config, wires the handler, and deploys.
argument-hint: "<form name or description>"
---

# Create a Form

Build a form that collects data from users. Forms are JSON config files in `surfaces/` that deploy as live web pages at `https://<workspace>.mug.work/<form-id>`. Submissions trigger a handler workflow.

For full API reference (all field types, condition operators, page branching, access modes, edit mode), see `.mug/docs/forms.md`.

## Input

Form name or description: `$ARGUMENTS`

If no argument provided, ask the user what the form should collect. Clarify:
- What information do they need? (fields and their types)
- Who fills it out? (public, verified identity, or restricted access)
- What should happen when someone submits? (email notification, AI processing, store in database)

## Step 1 — Name and plan

Pick a kebab-case name for the form (e.g., `service-request`, `intake`, `feedback`).

Present a brief plan:
- Fields needed (with types from the catalog below)
- Access mode (public, identify, or auth)
- Post-submission actions
- Single page or multi-page

Wait for user confirmation.

## Step 2 — Create the form config

Run `mug form init <name>` to scaffold a starter form, then edit the config. The form config lives at `surfaces/<name>.json`:

```json
{
  "type": "form",
  "title": "Service Request",
  "description": "Submit a new service request",
  "submitText": "Submit Request",
  "workflow": "handle-service-request",
  "access": { "mode": "public" },
  "fields": [
    { "name": "name", "type": "text", "label": "Your Name", "required": true },
    { "name": "email", "type": "email", "label": "Email", "required": true },
    { "name": "message", "type": "textarea", "label": "Message", "rows": 4 }
  ]
}
```

### Form config fields

- `type` — must be `"form"`
- `title` — form heading (required)
- `description` — subtitle text below heading
- `submitText` — submit button label (default: "Submit")
- `workflow` — name of the handler workflow that processes submissions (required)
- `access` — who can access the form (see Access Modes below)
- `fields` — shorthand for a single-page form (array of fields)
- `pages` — multi-page form (array of page objects, overrides `fields`)
- `editMode` — load and update existing records (see Edit Mode below)

## Step 3 — Write the submission handler workflow

When someone submits the form, a handler workflow runs. Submission data arrives as `ctx.params`. Create `workflows/handle-<name>.ts`:

```typescript
import { workflow } from "@mugwork/mug";

workflow("handle-<name>", async (ctx) => {
  const params = ctx.params as Record<string, string>;
  const name = params.name;
  const email = params._verified_email ?? params.email;

  // Store in database
  await ctx.exec(`INSERT INTO submissions (name, email, message, created_at)
    VALUES (?, ?, ?, datetime('now'))`, [name, email, params.message]);

  // Send notification
  await ctx.notify.email({
    to: "owner@example.com",
    subject: `New submission from ${name}`,
    message: `Name: ${name}\nEmail: ${email}\nMessage: ${params.message}`,
  });

  return { processed: true };
});
```

### Submission data in ctx.params

- All field values are available by field name: `params.name`, `params.email`, etc.
- **File fields** contain R2 URL strings (e.g., `"https://r2.mug.work/workspace/uploads/abc123.jpg"`). Use `fetch()` in a workflow to download and process uploaded files.
- `params._verified_email` — present when access mode is `identify` or `auth` with email
- `params._verified_phone` — present when access mode is `identify` or `auth` with phone
- `params._surface` — the form's surface ID
- `params._workspace` — workspace name
- `params._edit` — `true` when the submission is an edit of an existing record
- `params._editRecord` — original record data (edit mode only)

For the full `ctx.params` shape across all trigger types (forms, portals, webhooks), see `.mug/docs/api.md`.

## Step 4 — Test

```bash
mug dev                    # start the dev server — form is live immediately
```

Open `http://localhost:8787/<name>` in a browser to test. No need to run a workflow first — the form config is read directly from `surfaces/`.

For production:
```bash
mug deploy                 # deploy workspace — surfaces upload automatically
```

The production form lives at `https://<workspace>.mug.work/<name>`.

Workflows in `workflows/` are auto-discovered by `mug deploy` — no import needed.

## Step 5 — Validate (optional)

```bash
mug form validate          # check all form configs for errors
mug form list              # show forms and URLs
```

---

## Form Feature Catalog

Reference for all form capabilities. Use these when designing forms based on user requirements.

### Field Types

**Text fields** — single-line input:
```json
{ "name": "company", "type": "text", "label": "Company Name", "required": true, "placeholder": "Acme Inc." }
{ "name": "email", "type": "email", "label": "Email Address", "required": true }
{ "name": "phone", "type": "phone", "label": "Phone", "placeholder": "+1 555 123 4567" }
```
Add `pattern` for regex validation: `{ "type": "text", "pattern": "^[A-Z]{2}\\d{4}$" }`

**Number field** — numeric input with constraints:
```json
{ "name": "quantity", "type": "number", "label": "Quantity", "min": 1, "max": 100, "step": 1 }
```
Renders numeric keyboard on mobile. `min`, `max`, `step` are all optional.

**Select field** — dropdown:
```json
{
  "name": "urgency", "type": "select", "label": "Priority", "required": true,
  "options": [
    { "label": "Low", "value": "low" },
    { "label": "Medium", "value": "medium" },
    { "label": "High", "value": "high" }
  ]
}
```

**Multiselect field** — checkboxes (submitted as array):
```json
{
  "name": "services", "type": "multiselect", "label": "Services Needed",
  "options": [
    { "label": "Cleaning", "value": "cleaning" },
    { "label": "Repair", "value": "repair" },
    { "label": "Inspection", "value": "inspection" }
  ]
}
```

**Date field** — date picker:
```json
{ "name": "preferred_date", "type": "date", "label": "Preferred Date", "min": "2026-01-01", "max": "2026-12-31" }
```

**Textarea field** — multi-line text:
```json
{ "name": "notes", "type": "textarea", "label": "Additional Notes", "rows": 4, "maxLength": 2000 }
```
`rows` defaults to 3. `maxLength` is optional.

**File field** — file upload (stored in R2):
```json
{ "name": "photo", "type": "file", "label": "Upload Photo", "accept": "image/*", "maxSizeMb": 5 }
```
`accept` uses standard MIME types (`image/*`, `.pdf`, `application/pdf`). `maxSizeMb` defaults to 10. The submitted value is the R2 URL of the uploaded file.

**Calculated field** — auto-computed from other fields (read-only display):
```json
{ "name": "total", "type": "calculated", "label": "Estimated Total", "expression": "hours * rate", "format": "currency" }
```
`expression` references other field names. Supports `+`, `-`, `*`, `/`, `%`. Recalculates on every input change.
`format`: `"number"` (default), `"currency"` ($X.XX), `"percent"` (X.X%).

**Hidden field** — invisible, always submitted:
```json
{ "name": "form_version", "type": "hidden", "default": "v2" }
{ "name": "employee_id", "type": "hidden", "prefill": { "source": "auth", "column": "id" } }
```
Never rendered. Use for tracking params, form IDs, or auth-prefilled values the user shouldn't see.

### Default Values

Any field can have a `default` — pre-populated on load, lowest priority in the fill chain:
```json
{ "name": "status", "type": "hidden", "default": "pending" }
{ "name": "priority", "type": "select", "label": "Priority", "default": "medium", "options": [...] }
```

### Prefill

Auto-fill from three sources — auth row, URL params, or database:

**From auth row** (requires `auth` access mode — auto-fills from the user's table row):
```json
{ "name": "employee_name", "type": "text", "label": "Your Name",
  "prefill": { "source": "auth", "column": "name" }, "locked": true }
```

**From URL parameter:**
```json
{ "name": "department", "type": "text", "label": "Department",
  "prefill": { "source": "url", "param": "dept" } }
```

**From database record:**
```json
{ "name": "manager", "type": "text", "label": "Manager",
  "prefill": { "source": "db", "table": "departments", "column": "manager_name",
    "match": { "column": "id", "param": "dept_id" } }, "locked": true }
```

### Help Text

Display a hint below the field label. Supports `{{column}}` templates resolved from the auth row:
```json
{ "name": "hours", "type": "number", "label": "Hours Requested",
  "helpText": "You have {{available_pto_hours}} hours available" }
```

### Field Name Uniqueness

**Field names must be unique across the entire form** — including fields on different pages and conditional (`showWhen`) fields. Duplicate names cause silent data loss at submission. `mug form validate` and `mug dev` will error on duplicates.

### Validation Rules

Custom validation with user-facing error messages. Rules: `min`, `max`, `minLength`, `maxLength`, `pattern`. Values support `{{column}}` templates from the auth row:
```json
{ "name": "hours", "type": "number", "label": "Hours Requested", "required": true,
  "helpText": "You have {{available_pto_hours}} hours available",
  "validate": [
    { "rule": "min", "value": 0.5, "message": "Must request at least 30 minutes" },
    { "rule": "max", "value": "{{available_pto_hours}}", "message": "Cannot exceed your {{available_pto_hours}} available hours" }
  ]
}
```
Template values that resolve to numbers are auto-coerced for `min`/`max`. Validation runs client-side per-page.

### Locked Fields

`"locked": true` makes a field read-only + server-enforced. The submitted value is always the known source (auth row, default, etc.) regardless of HTML tampering:
```json
{ "name": "name", "type": "text", "label": "Your Name",
  "prefill": { "source": "auth", "column": "name" }, "locked": true }
```

### Conditional Fields

Show or hide any field based on other field values. Add `showWhen` to the field:

```json
{
  "name": "emergency_details", "type": "textarea", "label": "Describe the emergency",
  "required": true,
  "showWhen": [{ "field": "service_type", "op": "eq", "value": "emergency" }]
}
```

**Operators:** `eq`, `neq`, `in`, `gt`, `lt`, `filled`, `empty`

```json
showWhen: [{ "field": "category", "op": "in", "value": ["repair", "emergency"] }]
showWhen: [{ "field": "quantity", "op": "gt", "value": 10 }]
showWhen: [{ "field": "photo", "op": "filled" }]
```

Multiple conditions = AND logic (all must be true). Hidden fields are excluded from validation.

### Multi-Page Forms

Use the `pages` array instead of `fields` for multi-page forms:

```json
{
  "type": "form",
  "title": "Client Onboarding",
  "workflow": "handle-onboarding",
  "pages": [
    {
      "id": "contact",
      "title": "Contact Information",
      "fields": [
        { "name": "name", "type": "text", "label": "Name", "required": true },
        { "name": "email", "type": "email", "label": "Email", "required": true }
      ]
    },
    {
      "id": "details",
      "title": "Request Details",
      "fields": [
        { "name": "service_type", "type": "select", "label": "Service", "required": true, "options": [] },
        { "name": "notes", "type": "textarea", "label": "Notes" }
      ]
    }
  ]
}
```

The renderer auto-generates back/next buttons and a progress bar. Enter key advances pages. Validation runs per-page.

**Conditional pages** — show or hide entire pages:
```json
{ "id": "emergency-info", "title": "Emergency Details", "showWhen": [{ "field": "service_type", "op": "eq", "value": "emergency" }], "fields": [] }
```

### Page Branching

Route users to different pages based on their answers:

```json
{
  "id": "triage",
  "title": "What do you need?",
  "fields": [
    { "name": "request_type", "type": "select", "label": "Request Type", "required": true,
      "options": [
        { "label": "New Service", "value": "new" },
        { "label": "Emergency", "value": "emergency" }
      ]
    }
  ],
  "nextPage": {
    "conditions": [
      { "when": [{ "field": "request_type", "op": "eq", "value": "emergency" }], "goto": "urgent" }
    ],
    "default": "standard"
  }
}
```

Simple routing: `"nextPage": "details"` (string).

### Access Modes

Control who can access and submit the form.

**Choosing the right mode:**
- **`public`** — open form anyone can submit (contact us, feedback, public intake)
- **`identify`** — anyone can access after verifying email (self-service requests where you need to know who submitted)
- **`auth`** — only users in a database table can access (internal tools — employee forms, client-only portals)

**Rule of thumb:** if you have a table of who should access this form, use `auth`. If anyone with a valid email can submit, use `identify`.

**Public** — anyone can see and submit. No identity captured:
```json
"access": { "mode": "public" }
```

**Identify** — anyone can access after verifying email/phone:
```json
"access": { "mode": "identify", "method": "email", "sessionDuration": "7d" }
"access": { "mode": "identify", "method": "phone", "sessionDuration": "24h" }
```
Session duration format: `30m`, `24h`, `7d`. After verification, the user stays verified for this duration.

**Auth** — only users in a specific table can access the form:
```json
"access": {
  "mode": "auth",
  "method": "email",
  "table": "employees",
  "matchColumn": "email",
  "sessionDuration": "7d"
}
```

**Auth with computed columns** — use `query` to enrich the auth row with JOINs or calculations instead of a plain `SELECT *`. Use `:identity` as the placeholder for the authenticated user's email/phone:
```json
"access": {
  "mode": "auth",
  "method": "email",
  "table": "employees",
  "matchColumn": "email",
  "query": "SELECT e.*, r.hours_per_year - COALESCE(u.used, 0) AS available_pto FROM employees e LEFT JOIN pto_rules r ON r.employee_id = e.id LEFT JOIN (SELECT employee_id, SUM(hours) AS used FROM pto_requests WHERE status != 'denied' GROUP BY employee_id) u ON u.employee_id = e.id WHERE e.email = :identity",
  "sessionDuration": "7d"
}
```
Computed columns from `query` are available everywhere the auth row is used: `{{templates}}` in help text and validation, `prefill: { source: "auth" }`, and `ctx.params._auth_row` in workflows. Values are always fresh — no denormalized state to maintain. `table` and `matchColumn` are still required (used for dev-mode user dropdown).

In dev mode (`mug dev`), `auth` surfaces show a dropdown of registered users. `identify` surfaces show a freeform email input. Both bypass verification.

### Edit Mode

Load an existing record into the form for editing:
```json
"editMode": {
  "table": "service_requests",
  "recordParam": "id",
  "matchColumn": "id"
}
```
Edit URL: `https://<workspace>.mug.work/<form-id>?id=123`

### Prefill from URL Parameters

Any URL parameter that matches a field name pre-fills that field:
```
https://<workspace>.mug.work/<form-id>?name=John&email=john@example.com
```

### Breadcrumbs (cross-surface navigation)

When linking to a form from another surface (e.g., a portal), add `?from=` and `?fromLabel=` query params to show a "Back" breadcrumb above the form header:
```
/request-form?from=/employee-portal&fromLabel=Back to Portal
```
When the form is opened directly (no `?from=`), no breadcrumb appears. `fromLabel` is optional — defaults to "Back".

---

## Advanced: Dynamic Forms (ctx.collect)

For forms that need to be generated programmatically at runtime — when fields depend on database state, forms are generated per-user, or you're A/B testing form variations — use `ctx.collect()` inside a workflow instead of a static JSON config.

```typescript
import { workflow } from "@mugwork/mug";

workflow("create-dynamic-form", async (ctx) => {
  const url = await ctx.collect({
    id: "dynamic-intake",
    title: "Intake Form",
    workflow: "handle-intake",
    access: { mode: "public" },
    fields: [
      { name: "name", type: "text", label: "Name", required: true },
    ],
  });
  return { formUrl: url };
});
```

**Important:** Dynamic forms created via `ctx.collect()` require running the creation workflow before the form URL works. In production, run `mug run <workflow> --production` after deploying. In local dev, `ctx.collect()` does not persist the form config — use static JSON configs for local development.

---

## Complete Example

Employee time-off request with auth prefill — name auto-fills and locks from the employees table:

**Form config** (`surfaces/request-timeoff.json`):
```json
{
  "type": "form",
  "title": "Time-Off Request",
  "description": "Submit a time-off request for manager approval.",
  "submitText": "Submit Request",
  "workflow": "handle-timeoff",
  "access": {
    "mode": "auth",
    "method": "email",
    "table": "employees",
    "matchColumn": "email",
    "sessionDuration": "7d"
  },
  "fields": [
    { "name": "employee_id", "type": "hidden", "prefill": { "source": "auth", "column": "id" } },
    { "name": "employee_name", "type": "text", "label": "Your Name",
      "prefill": { "source": "auth", "column": "name" }, "locked": true },
    { "name": "start_date", "type": "date", "label": "Start Date", "required": true },
    { "name": "end_date", "type": "date", "label": "End Date", "required": true },
    {
      "name": "type", "type": "select", "label": "Type", "required": true,
      "options": [
        { "label": "PTO", "value": "PTO" },
        { "label": "Sick", "value": "Sick" },
        { "label": "Personal", "value": "Personal" }
      ]
    },
    { "name": "hours", "type": "number", "label": "Hours", "required": true,
      "helpText": "You have {{available_pto_hours}} hours available",
      "validate": [
        { "rule": "min", "value": 0.5, "message": "Must request at least 30 minutes" },
        { "rule": "max", "value": "{{available_pto_hours}}", "message": "Cannot exceed your {{available_pto_hours}} available hours" }
      ]
    },
    { "name": "reason", "type": "textarea", "label": "Reason", "rows": 3 }
  ]
}
```

**Submission handler** (`workflows/handle-timeoff.ts`):
```typescript
import { workflow } from "@mugwork/mug";

workflow("handle-timeoff", async (ctx) => {
  const params = ctx.params as Record<string, string>;
  const email = params._verified_email;

  await ctx.exec(`CREATE TABLE IF NOT EXISTS time_off_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER, employee_email TEXT,
    employee_name TEXT, start_date TEXT, end_date TEXT, type TEXT, hours REAL,
    reason TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
  )`);

  await ctx.exec(`INSERT INTO time_off_requests
    (employee_id, employee_email, employee_name, start_date, end_date, type, hours, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [params.employee_id, email, params.employee_name, params.start_date,
     params.end_date, params.type, params.hours, params.reason ?? ""]);

  await ctx.notify.email({
    to: "manager@example.com",
    subject: `Time-off request from ${params.employee_name}`,
    message: `${params.employee_name} requested ${params.hours}h of ${params.type} from ${params.start_date} to ${params.end_date}.`,
    cta: { label: "Review Requests", url: ctx.surfaceUrl("approvals") },
  });

  return { submitted: true };
});
```

**Test:**
```bash
mug dev
open http://localhost:8787/request-timeoff
```

For displaying submitted data back to users (dashboards, status trackers, approval inboxes), see the `/portal` skill.
For custom branding (logo and accent color on forms), add a `branding` section to `mug.json` — see `.mug/docs/forms.md`. Individual forms can override workspace branding with `"branding": { "logoSquare": "files/logo.png", "accentColor": "#hex" }` in the form JSON.
