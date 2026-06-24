# Demo Mode — Full API Reference

Share deployed auth'd surfaces with stakeholders without requiring verification. For a guided walkthrough, use the `/demo` skill.

## How it works

`mug demo enable` creates a pre-authenticated session for a surface. Any visitor to the surface URL sees it as the specified identity — no email/phone verification required. The demo record is stored in Cloudflare KV with automatic expiry.

Demo mode applies to deployed surfaces (on `*.mug.work`) **and the workspace home screen**. Local dev (`mug dev`) has its own notification safety net via `mug.json` dev overrides — the two systems are independent.

## Home screen demo mode

The workspace home screen (`subdomain.mug.work/`) **requires authentication** — it is not public. Visitors must verify via email/phone before seeing any content. The home screen uses a three-tier auth flow: demo mode check → session cookie check → auth gate.

To demo the home screen, use `_home` as the surface ID:

```bash
mug demo enable _home --as demo@example.com
mug demo disable _home
```

Demo mode on `_home` bypasses the home screen auth gate. The visitor sees the home screen as the specified identity, with access to the surfaces that identity can reach. **Demo mode on individual surfaces does not carry over to the home screen** — you must enable `_home` separately if you want the home screen itself to be demo-accessible.

## CLI commands

### mug demo enable \<surface\>

Enable demo mode on a deployed surface.

```bash
mug demo enable employee-portal --as demo@example.com
mug demo enable time-off-form --as jane@acme.com --expires 30d
mug demo enable employee-portal --as demo@example.com --notify dev --sms-to +15551234567
mug demo enable employee-portal --as demo@example.com --no-workflows
```

**Required:**
- `--as <identity>` — email or phone number to authenticate as. Must exist in the surface's auth table if using `access.mode: "auth"`.

**Optional:**
- `--expires <duration>` — expiry duration (default: `7d`). Accepts `Nd` (days) or `Nh` (hours).
- `--notify <mode>` — notification routing mode (default: `demo-user`). See Notification Modes below.
- `--email-to <address>` — override: redirect email notifications to this address.
- `--sms-to <phone>` — override: redirect SMS notifications to this phone number (E.164 format).
- `--slack-to <channel>` — override: redirect Slack notifications to this channel or user.
- `--no-workflows` — suppress workflow execution on surface submissions.

### mug demo disable \<surface\>

Immediately disable demo mode on a surface.

```bash
mug demo disable employee-portal
```

### mug demo status

Show all active demos for the current workspace.

```bash
mug demo status
```

## Notification modes

Demo mode automatically routes notifications — builders do not need `if (ctx.isDemo)` guards for `ctx.notify.*` calls.

### demo-user (default)

All notifications redirect to the `--as` identity. Channel matching:
- If identity is an email: `ctx.notify.email()` sends to that email. SMS and Slack are suppressed.
- If identity is a phone: `ctx.notify.sms()` sends to that phone. Email and Slack are suppressed.
- Per-channel overrides fill in non-matching channels.

### dev

All notifications redirect to the developer who ran `mug demo enable`:
- Email sends to the developer's account email (from `~/.mug/credentials`).
- SMS and Slack are suppressed unless overridden with `--sms-to` or `--slack-to`.

### off

All notifications suppressed. Still logged in workflow step output (visible in `mug logs`).

## Per-channel overrides

Overrides take precedence over the notification mode. They work with any `--notify` value.

```bash
# demo-user mode, but also send SMS to your phone
mug demo enable portal --as demo@example.com --sms-to +15551234567

# dev mode, but send Slack to a specific channel
mug demo enable portal --as demo@example.com --notify dev --slack-to #demo-reviews

# off mode, but still send email (for testing email rendering)
mug demo enable portal --as demo@example.com --notify off --email-to test@example.com
```

## Workflow suppression

`--no-workflows` prevents any workflow from firing when the demo surface is submitted or a portal action is triggered. The surface still renders, accepts form input, and shows the success state — but no server-side workflow executes.

This is orthogonal to notification modes. You can combine them:

```bash
# Show the form UI only — no workflow, no notifications
mug demo enable time-off-form --as demo@example.com --no-workflows

# Workflows run but notifications are off
mug demo enable time-off-form --as demo@example.com --notify off
```

When workflows are suppressed, the API returns `{ "status": "ok", "demo": true, "workflowSkipped": true }`.

## ctx.isDemo

```typescript
get isDemo(): boolean
```

`true` when the workflow was triggered from a surface in demo mode. Since notifications are automatically routed by demo config, `ctx.isDemo` is only needed for guarding non-notification side effects:

```typescript
workflow("approve-request", async (ctx) => {
  // Notifications auto-routed — no guard needed
  await ctx.notify.email({
    to: ctx.params.manager_email,
    subject: "Request approved",
    message: `${ctx.params.employee_name}'s request was approved.`,
  });

  await ctx.notify.sms({
    to: ctx.params.employee_phone,
    message: "Your time-off request was approved!",
  });

  // Guard destructive writes and external calls
  if (ctx.isDemo) return;
  await ctx.exec("UPDATE requests SET status = 'approved' WHERE id = ?", [ctx.params.request_id]);
});
```

## Suppressed notification logging

All notifications — whether redirected or suppressed — are recorded as workflow steps in `mug logs`. Suppressed notifications show the reason:

```
notify-email-1  | 2ms  | to: manager@company.com → demo@example.com  | delivery_ok
notify-sms-2    | 0ms  | to: +15559876543                            | suppressed (demo mode: demo-user)
```

This lets you verify the complete workflow path without sending real notifications.

## Demo mode vs local dev

| Aspect | Demo mode (`mug demo enable`) | Local dev (`mug dev`) |
|--------|-------------------------------|----------------------|
| Where | Deployed surfaces on `*.mug.work` | `localhost:8787` |
| Auth | Pre-authenticated via KV record | Dev banner identity cookie |
| Notifications | Routed by `--notify` mode + overrides | Routed by `mug.json` dev overrides |
| `ctx.isDemo` | `true` | `false` |
| Workflows | Configurable (`--no-workflows`) | Always run |

The two systems are independent. A surface can be in demo mode in production while you develop locally with different settings.

## KV record format

Stored at `demo:{workspace}:{surfaceId}` with automatic TTL expiry:

```json
{
  "identity": "demo@example.com",
  "createdAt": "2026-05-14T10:00:00.000Z",
  "expiresAt": "2026-05-21T10:00:00.000Z",
  "notifyMode": "demo-user",
  "notifyOverrides": { "sms": "+15551234567" },
  "devEmail": "developer@example.com",
  "workflows": true
}
```

## Complete example

```bash
# 1. Create a demo persona with curated data
mug sql main "INSERT INTO employees (email, name, role, manager_email) VALUES ('demo@example.com', 'Demo User', 'Technician', 'demo-mgr@example.com')"
mug sql main "INSERT INTO time_off_requests (employee_email, start_date, end_date, status) VALUES ('demo@example.com', '2026-06-01', '2026-06-05', 'pending')"

# 2. Enable demo — notifications go to you, SMS to your phone
mug demo enable employee-portal --as demo@example.com --notify dev --sms-to +15551234567

# 3. Share the URL with stakeholder
# https://my-workspace.mug.work/employee-portal

# 4. Check status
mug demo status

# 5. When done
mug demo disable employee-portal
```
