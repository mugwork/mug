# Notifications — Full API Reference

Send email and SMS notifications from workflows. Mug handles delivery via Resend (email) and Twilio (SMS), renders styled HTML email templates, and generates correct surface URLs for dev and production. SMS works out of the box — BYOK optional for your own number.

For a guided walkthrough, use the `/notify` skill. For full `ctx.notify.*` method signatures and error behavior, see [api.md — notifications](api.md#ctxnotifyemailoptions).

## ctx.notify.email(options)

Send a styled HTML email via Mug's notification service. For the full method signature, return type, and error behavior, see [api.md — ctx.notify.email](api.md#ctxnotifyemailoptions).

```typescript
await ctx.notify.email({
  to: "manager@company.com",
  subject: `New request from ${name}`,
  message: `**${name}** submitted a request.\n\n- Type: ${type}\n- Urgency: ${urgency}`,
  fromName: "Acme Operations",
  cta: { label: "Review Request", url: ctx.surfaceUrl("approvals") },
});
```

### Email template

Emails are rendered as responsive HTML with:
- Clean white layout
- Sender name in the header
- Message body with markdown formatting
- Optional CTA button (centered, styled with workspace accent color)
- "Powered by Mug" footer (replaced with workspace branding at Pro+ tiers)

The `text` version (for plain-text email clients) is the raw `message` string.

### Markdown support in message body

| Syntax | Renders as |
|--------|-----------|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `- item` | bullet list |
| `1. item` | numbered list |
| `[text](url)` | clickable link |
| Blank line | paragraph break |

**Not supported:** headers (`#`), code blocks, tables, images. Keep email content simple — use the CTA button for primary actions.

### Loading templates from files

For complex email bodies, store templates in `files/` and load them at runtime:

```typescript
const template = await ctx.fileText("templates/weekly-report.html");
const body = template
  .replace("{{name}}", customer.name)
  .replace("{{total}}", formatCurrency(total));
await ctx.notify.email({ to: customer.email, message: body, subject: "Weekly Report" });
```

Drop template files in `files/templates/` and run `mug push` to upload them to production. See [api.md](api.md) for the full `ctx.file()` / `ctx.fileText()` reference.

### Examples

Simple notification:
```typescript
await ctx.notify.email({
  to: "user@example.com",
  subject: "Payment received",
  message: "We received your payment of **$250.00**. Thank you!",
});
```

With CTA button:
```typescript
await ctx.notify.email({
  to: "manager@company.com",
  subject: `New request from ${employeeName}`,
  message: `**${employeeName}** submitted a time-off request for ${startDate} to ${endDate}.`,
  cta: {
    label: "Review Request",
    url: ctx.surfaceUrl("approvals"),
  },
});
```

Custom sender name:
```typescript
await ctx.notify.email({
  to: "client@example.com",
  subject: "Your weekly report",
  message: reportMarkdown,
  fromName: "Acme Operations",
});
```

## ctx.notify.sms(options)

Send an SMS message via Twilio. Provider is auto-selected based on workspace secrets — uses Twilio.

```typescript
await ctx.notify.sms({
  to: string;       // phone number in E.164 format (+1234567890)
  message: string;  // plain text message body
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | yes | Phone number in E.164 format (e.g., `+1234567890`) |
| `message` | string | yes | Plain text message. No markdown — SMS is plain text only |

SMS is best for urgent, time-sensitive notifications. Keep messages under 160 characters when possible (longer messages are split into segments and cost more).

```typescript
await ctx.notify.sms({
  to: "+1234567890",
  message: `Job assigned: ${job.address}. ETA: ${job.eta}. Reply ACCEPT or DECLINE.`,
});
```

## ctx.notify.slack(options)

Send a Slack message (requires Slack integration configured).

```typescript
await ctx.notify.slack({
  to: string;       // channel name or user ID
  message: string;  // message body
});
```

## ctx.surfaceUrl(surfaceId, path?)

Generate a URL to a workspace surface. See [api.md — ctx.surfaceUrl](api.md#ctxsurfaceurlsurfaceid-path) for the full signature. Always use this instead of hardcoding URLs in notification messages — it handles dev/prod automatically.

```typescript
ctx.surfaceUrl("approvals")              // → localhost:8787/approvals (dev) or workspace.mug.work/approvals (prod)
ctx.surfaceUrl("portal", `/row/${id}`)   // → .../portal/row/42
```

## Local dev behavior

In local dev (`mug dev`), notifications send via real delivery services:

- **Email**: sends via Resend using the `RESEND_API_KEY` from `.mug/secrets`. Real emails arrive in the recipient's inbox.
- **SMS**: sends via Twilio using configured credentials from `.mug/secrets`.

### Dev email redirect

`mug init`, `mug create`, `mug update`, and `mug dev` auto-set `dev.email` in `mug.json` to the logged-in user's email. All dev emails redirect to this address instead of real recipients.

```json
{
  "dev": {
    "email": "developer@example.com"
  }
}
```

When set, **all email notifications redirect to this address**. The subject line is prefixed with the original recipient so you can see who would have received it: `[DEV → manager@company.com] New request from John Smith`. Changes to `mug.json` hot-reload — no restart needed.

Every notification is also logged to the console:
```
[email] Redirecting: manager@company.com → developer@example.com
```

If `RESEND_API_KEY` is not set, emails log to console only (no delivery).

## Notification metering

Mug-managed sends count against your plan's notification limits:

| Tier | Email/month | SMS/month |
|------|-------------|-----------|
| Free | 100 | 50 |
| Starter ($99) | 1,500 | 500 |
| Pro ($299) | 5,000 | 1,000 |
| Business ($599) | 15,000 | 2,500 |

BYOK sends (using your own Resend/Twilio keys) bypass metering entirely.

## BYOK — bring your own keys

Use your own Resend or Twilio account for unlimited sends, custom sending domains, and your own deliverability reputation. SMS works out of the box using Mug's platform number — BYOK is optional if you want your own number or unlimited unmetered sends.

```bash
# Email
mug secret set RESEND_API_KEY=re_xxxxx

# SMS — BYOK Twilio (optional — SMS works out of the box)
mug secret set TWILIO_ACCOUNT_SID=AC_xxxxx
mug secret set TWILIO_AUTH_TOKEN=xxxxx
mug secret set TWILIO_PHONE_NUMBER=+1xxxxx
```

When BYOK keys are set, notifications route through your account instead of Mug's. Your keys, your bill, unlimited volume.

**Inbound SMS (bidirectional):** Mug's platform number is outbound-only. To receive inbound SMS replies, bring your own Twilio number and point its webhook to `https://api.mug.work/inbound/sms/<workspace>`.

## Branding

Email notifications automatically pick up workspace branding from `mug.json`:

```json
{
  "branding": {
    "logo": "assets/logo.png",
    "logoSquare": "assets/icon.png",
    "accentColor": "#1a5276"
  }
}
```

- **logo** — displayed in the email header (max 40px height, 200px width). Replaces the default text-based workspace name.
- **accentColor** — applied to CTA button backgrounds and the footer separator line.
- When a logo is set, the email footer shows the workspace display name instead of "Powered by Mug".

No code changes needed — `ctx.notify.email()` reads branding from the workspace environment automatically. In dev, the dev proxy injects branding from `mug.json`. In production, branding is set via the `MUG_BRANDING` environment variable at deploy time.

## CLI commands

```bash
mug secret set RESEND_API_KEY=re_xxxxx       # configure email delivery (BYOK)
mug secret set TWILIO_ACCOUNT_SID=AC_xxxxx   # configure SMS via Twilio (BYOK, optional)
mug secret list                            # verify keys are set
mug dev                                    # test notifications locally
mug run <workflow>                         # trigger workflow to send
mug logs <workflow>                        # see notification step results
```

## Complete example

Full approval notification flow — form submission notifies manager, approval notifies employee:

```typescript
// workflows/handle-request.ts — triggered by form submission
import { workflow } from "@mugwork/mug";

workflow("handle-request", async (ctx) => {
  const p = ctx.params as Record<string, string>;

  // Insert the request
  await ctx.exec("main", `INSERT INTO time_off_requests
    (id, employee_name, employee_email, type, start_date, end_date, hours, reason, approver_email, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
    [crypto.randomUUID(), p.employee_name, p.employee_email, p.type,
     p.start_date, p.end_date, p.hours, p.reason, "manager@company.com"]);

  // Email the manager with a link to the approval inbox
  await ctx.notify.email({
    to: "manager@company.com",
    subject: `Time-off request from ${p.employee_name}`,
    message: `**${p.employee_name}** is requesting **${p.type}** from ${p.start_date} to ${p.end_date} (${p.hours} hours).\n\nReason: ${p.reason}`,
    cta: { label: "Review Request", url: ctx.surfaceUrl("approvals") },
  });

  return { status: "pending", notified: "manager@company.com" };
});

// workflows/handle-approval.ts — triggered by portal action button
import { workflow } from "@mugwork/mug";

workflow("handle-approval", async (ctx) => {
  const p = ctx.params as Record<string, string>;
  const status = p.action === "approve" ? "approved" : "denied";

  // Update the request
  await ctx.exec("main",
    "UPDATE time_off_requests SET status = ?, reviewed_at = datetime('now') WHERE id = ?",
    [status, p.id]);

  // Notify the employee with a link to their portal
  await ctx.notify.email({
    to: p.employee_email,
    subject: `Your time-off request was ${status}`,
    message: `Your **${p.type}** request for ${p.start_date} to ${p.end_date} has been **${status}**.`,
    cta: { label: "View My Requests", url: ctx.surfaceUrl("portal") },
  });

  return { id: p.id, status, notified: p.employee_email };
});
```

For form creation (the request form that triggers notifications), see the `/form` skill.
For portals (the approval inbox and employee portal), see the `/portal` skill.
For workflow logic (AI classification, multi-source queries), see the `/workflow` skill.
