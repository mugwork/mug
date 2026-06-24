---
name: notify
description: Send email or SMS notifications from workflows — styled templates with CTA buttons, surface links, workspace branding. Covers ctx.notify.email(), ctx.surfaceUrl(), and local dev delivery.
argument-hint: "<notification type or description>"
---

# Send Notifications

Send email or SMS notifications from workflows. Mug handles delivery (Resend for email, Twilio for SMS), styled HTML templates, and surface link generation. SMS works out of the box — BYOK optional for your own number.

For full API reference (all options, template rendering, BYOK configuration), see `.mug/docs/notifications.md`.

## Input

Notification description: `$ARGUMENTS`

If no argument provided, ask the user what they need to send. Clarify:
- What triggers the notification? (form submission, workflow step, schedule)
- Who receives it? (employee, manager, customer — how do you know their email/phone?)
- What should the message say?
- Should it link back to a surface? (portal, form, approval inbox)

## Step 1 — Plan the notification

Identify:
- Which workflow sends it
- What data is available at send time (from query results, form params, etc.)
- Whether it needs a CTA button linking to a surface
- Email or SMS (or both)

Present a brief plan and wait for confirmation.

## Step 2 — Write the notification code

Add `ctx.notify.email()` or `ctx.notify.sms()` to the workflow:

```typescript
import { workflow } from "@mugwork/mug";

workflow("handle-request", async (ctx) => {
  const params = ctx.params as Record<string, string>;

  // Insert the record
  await ctx.exec("INSERT INTO requests (...) VALUES (...)", [...]);

  // Notify the manager with a link to the approval surface
  await ctx.notify.email({
    to: "manager@company.com",
    subject: `New request from ${params.employee_name}`,
    message: `${params.employee_name} submitted a time-off request for ${params.start_date} to ${params.end_date}.`,
    cta: {
      label: "Review Request",
      url: ctx.surfaceUrl("approvals"),
    },
  });

  return { notified: true };
});
```

### ctx.notify.email(options)

```typescript
await ctx.notify.email({
  to: string;            // recipient email address
  message: string;       // supports: **bold**, *italic*, - lists, 1. lists, [links](url). No headers/code/tables/images.
  subject?: string;      // email subject line (default: "Notification from Mug")
  fromName?: string;     // sender name (default: workspace name, e.g. "Narvick Construction")
  cta?: {
    label: string;       // button text, e.g. "Review Request"
    url: string;         // button URL — use ctx.surfaceUrl() for surface links
  };
});
```

### ctx.notify.sms(options)

```typescript
await ctx.notify.sms({
  to: string;       // phone number (E.164 format: +1234567890)
  message: string;  // message body (plain text, no markdown)
});
```

### ctx.surfaceUrl(surfaceId, path?)

Generate a URL to a surface. Returns the correct URL for dev (localhost) and production (workspace subdomain).

```typescript
ctx.surfaceUrl("approvals")
// dev:  "http://localhost:8787/approvals"
// prod: "https://my-workspace.mug.work/approvals"

ctx.surfaceUrl("portal", `/row/${requestId}`)
// dev:  "http://localhost:8787/portal/row/42"
// prod: "https://my-workspace.mug.work/portal/row/42"
```

Always use `ctx.surfaceUrl()` instead of hardcoding URLs — it handles dev/prod automatically.

### Email templates from files

For complex email bodies, store HTML templates in `files/` and load them at runtime:

```typescript
const template = await ctx.fileText("templates/weekly-report.html");
const body = template.replace("{{name}}", customer.name).replace("{{total}}", total);
await ctx.notify.email({ to: customer.email, message: body, subject: "Weekly Report" });
```

Drop templates in `files/templates/` and run `mug push` to upload them to production.

## Step 3 — Test locally

```bash
mug dev          # start the dev server
mug run <workflow>   # trigger the workflow
```

**Dev email redirect:** `dev.email` in `mug.json` is auto-set to the logged-in user's email by `mug init`/`mug create`/`mug update`/`mug dev`. All email notifications redirect to this address in dev mode.

```json
{
  "dev": {
    "email": "developer@example.com"
  }
}
```

All emails redirect to this address. The subject shows the original recipient: `[DEV → manager@company.com] New request`. The console logs redirects:
```
[email] Redirecting: manager@company.com → developer@example.com
```

SMS sends via Twilio in dev too. Check the console for delivery status.

## Step 4 — Verify the email

Check the received email:
- Subject line is correct
- Message body renders with proper formatting
- CTA button links to the right surface URL
- Sender name shows the workspace name (not "Mug")

---

## Notification Patterns

Common patterns for notifications in workflows.

### Form submission notification

Notify someone when a form is submitted. The handler workflow receives form data in `ctx.params`:

```typescript
workflow("handle-intake", async (ctx) => {
  const { name, email, issue } = ctx.params as Record<string, string>;

  await ctx.exec("INSERT INTO tickets (name, email, issue, status) VALUES (?, ?, ?, 'open')",
    [name, email, issue]);

  await ctx.notify.email({
    to: "support@company.com",
    subject: `New ticket from ${name}`,
    message: `**${name}** (${email}) submitted a support ticket:\n\n${issue}`,
    cta: { label: "View Tickets", url: ctx.surfaceUrl("tickets") },
  });
});
```

### Approval result notification

Notify the requester when their request is approved/denied:

```typescript
workflow("handle-approval", async (ctx) => {
  const params = ctx.params as Record<string, string>;
  const status = params.action === "approve" ? "approved" : "denied";

  await ctx.exec("UPDATE requests SET status = ? WHERE id = ?", [status, params.id]);

  await ctx.notify.email({
    to: params.employee_email,
    subject: `Your request was ${status}`,
    message: `Your time-off request for ${params.start_date} to ${params.end_date} has been ${status}.`,
    cta: { label: "View Details", url: ctx.surfaceUrl("portal", `/row/${params.id}`) },
  });
});
```

### Scheduled report notification

Send a summary on a schedule:

```typescript
workflow("weekly-summary", async (ctx) => {
  const openTickets = await ctx.query("SELECT COUNT(*) as count FROM tickets WHERE status = 'open'");
  const resolved = await ctx.query("SELECT COUNT(*) as count FROM tickets WHERE status = 'resolved' AND resolved_at > date('now', '-7 days')");

  await ctx.notify.email({
    to: "owner@company.com",
    subject: `Weekly Summary — ${new Date().toLocaleDateString()}`,
    message: `**This week:**\n- ${resolved[0].count} tickets resolved\n- ${openTickets[0].count} tickets still open`,
    cta: { label: "View Dashboard", url: ctx.surfaceUrl("dashboard") },
  });
});
```

### SMS notification

SMS is best for urgent, time-sensitive notifications. Keep messages short.

```typescript
await ctx.notify.sms({
  to: "+1234567890",
  message: `New job assigned: ${job.address}. Reply ACCEPT or DECLINE.`,
});
```

### BYOK — bring your own keys

To send from your own email domain or Twilio account, set your own API keys:

```bash
mug secret set RESEND_API_KEY=re_xxxxx          # your Resend key
mug secret set TWILIO_ACCOUNT_SID=AC_xxxxx      # your Twilio account
mug secret set TWILIO_AUTH_TOKEN=xxxxx
mug secret set TWILIO_PHONE_NUMBER=+1xxxxx
```

BYOK sends bypass Mug's notification metering — unlimited sends, your own deliverability reputation.

AI also supports BYOK — `mug secret set ai.anthropic=<key>` for unlimited AI calls. See the `/ai` skill for setup.

---

## Complete Example

Full approval flow: form submission triggers manager notification, approval triggers employee notification.

```typescript
// workflows/handle-request.ts
import { workflow } from "@mugwork/mug";

workflow("handle-request", async (ctx) => {
  const p = ctx.params as Record<string, string>;

  await ctx.exec(`INSERT INTO requests (id, employee_name, employee_email, type, start_date, end_date, hours, reason, approver_email, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
    [crypto.randomUUID(), p.employee_name, p.employee_email, p.type, p.start_date, p.end_date, p.hours, p.reason, "manager@company.com"]);

  await ctx.notify.email({
    to: "manager@company.com",
    subject: `Time-off request from ${p.employee_name}`,
    message: `**${p.employee_name}** is requesting ${p.type} from ${p.start_date} to ${p.end_date} (${p.hours} hours).\n\nReason: ${p.reason}`,
    cta: { label: "Review Request", url: ctx.surfaceUrl("approvals") },
  });

  return { status: "pending", notified: "manager@company.com" };
});

// workflows/handle-approval.ts
import { workflow } from "@mugwork/mug";

workflow("handle-approval", async (ctx) => {
  const p = ctx.params as Record<string, string>;
  const status = p.action === "approve" ? "approved" : "denied";

  await ctx.exec("UPDATE requests SET status = ?, reviewed_at = datetime('now') WHERE id = ?", [status, p.id]);

  await ctx.notify.email({
    to: p.employee_email,
    subject: `Your time-off request was ${status}`,
    message: `Your ${p.type} request for ${p.start_date} to ${p.end_date} has been **${status}**.`,
    cta: { label: "View My Requests", url: ctx.surfaceUrl("portal") },
  });

  return { id: p.id, status };
});
```

For form creation (the request form), see the `/form` skill.
For portals (the approval inbox and employee portal), see the `/portal` skill.
For complex workflow logic (AI classification, multi-source queries), see the `/workflow` skill.
For custom branding on email notifications (logo in header, accent color on CTA buttons), add a `branding` section to `mug.json` — see `.mug/docs/notifications.md`.
