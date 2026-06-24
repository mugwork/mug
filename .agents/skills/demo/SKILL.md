---
name: demo
description: Share deployed surfaces with stakeholders — pre-authenticated links, notification routing, workflow control. Covers mug demo enable/disable/status and ctx.isDemo.
argument-hint: "<surface name or demo question>"
---

# Demo Mode

Share deployed auth'd surfaces with stakeholders without requiring them to verify. Demo mode creates pre-authenticated links with configurable notification routing and optional workflow suppression.

For full API reference (all flags, notification modes, KV record format), see `.mug/docs/demo.md`.

## Input

Surface name or question: `$ARGUMENTS`

If no argument provided, ask the user what they need:
- Which surface to demo? (must be auth-gated — not public). Use `_home` for the workspace home screen.
- Who should view it as? (email or phone identity from their auth table)
- Should notifications fire? If so, where should they go?
- Should workflows run on form submission?

## Step 1 — Prerequisites

Verify:
1. Surface exists in `surfaces/` and has `access.mode` set to `"identify"` or `"auth"` (demo mode is not needed for public surfaces). **Exception: `_home` (workspace home screen) always requires auth — it is never public.**
2. If using `--as` with an email from the auth table, confirm the identity exists in the table so the surface shows real data
3. Surface is deployed (`mug deploy` has been run)

**Important:** The workspace home screen (`subdomain.mug.work/`) requires authentication. It is NOT public. To demo it, use `_home` as the surface ID. Demo mode on individual surfaces does NOT carry over to the home screen — you must enable `_home` separately.

## Step 2 — Enable demo mode

```bash
# Basic: demo as a specific identity
mug demo enable <surface> --as demo@example.com

# With notification routing
mug demo enable <surface> --as demo@example.com --notify dev
mug demo enable <surface> --as demo@example.com --sms-to +15551234567

# Suppress workflows (show form UI only)
mug demo enable <surface> --as demo@example.com --no-workflows

# Custom expiry
mug demo enable <surface> --as demo@example.com --expires 30d
```

Present the command and explain what will happen. Wait for confirmation.

## Step 3 — Verify demo is active

```bash
mug demo status
```

Test the surface URL in a browser — it should render without requiring verification.

## Step 4 — Update workflow code (if needed)

Notification routing is automatic — no code changes needed for `ctx.notify.*` calls. The `--notify` mode handles redirection/suppression transparently.

Only add `ctx.isDemo` guards for non-notification side effects:

```typescript
workflow("handle-request", async (ctx) => {
  // Notifications auto-routed by demo config — no guard needed
  await ctx.notify.email({ to: params.manager_email, message: "New request" });

  // Guard destructive writes
  if (ctx.isDemo) return;
  await ctx.exec("UPDATE requests SET status = 'submitted' WHERE id = ?", [params.id]);
});
```

## Feature Catalog

### Notification modes

| Mode | Behavior |
|------|----------|
| `demo-user` (default) | Redirect to `--as` identity. Email→email identity, SMS→phone identity. Non-matching channels suppressed. |
| `dev` | Redirect to developer's account email. SMS/Slack suppressed unless overridden. |
| `off` | Suppress all. Logged in `mug logs` but not sent. |

### Per-channel overrides

Override any mode for specific channels:
- `--email-to <address>` — redirect email to this address
- `--sms-to <phone>` — redirect SMS to this number
- `--slack-to <channel>` — redirect Slack to this channel/user

Overrides take precedence over the mode. Combine with any `--notify` value.

### Workflow suppression

`--no-workflows` prevents any workflow from firing on surface submissions. The surface still renders, accepts input, and shows success — but nothing executes server-side. Use when demoing form UI without triggering backend logic.

### ctx.isDemo

`true` in workflows triggered from demo surfaces. Notifications are already handled by demo config — use `ctx.isDemo` only for:
- Destructive database writes
- External API calls (payment processing, third-party integrations)
- State mutations that shouldn't happen during a demo

### Suppressed notification logging

All suppressed notifications appear in `mug logs` step output with the reason:
```
notify-email-1: suppressed (demo mode: demo-user)
notify-sms-2: suppressed (demo mode: off)
```

This lets you verify the workflow path without sending real notifications.

### Home screen demo

The workspace home screen (`subdomain.mug.work/`) **requires authentication** — it is not public. Use `_home` as the surface ID:

```bash
mug demo enable _home --as demo@example.com
mug demo disable _home
```

Demo mode on `_home` must be set **separately** from individual surfaces. Enabling demo on a surface like `employee-portal` does not make the home screen accessible — visitors still hit the auth gate at the root URL.

### Managing demos

```bash
mug demo status              # list all active demos
mug demo disable <surface>   # immediately revoke
```

Demos auto-expire based on `--expires` (default 7 days). No cleanup needed.

## Complete Example

```bash
# 1. Create a demo persona in your auth table
mug sql main "INSERT INTO employees (email, name, role) VALUES ('demo@example.com', 'Demo User', 'Technician')"

# 2. Enable demo on both home screen and surfaces
mug demo enable _home --as demo@example.com --notify dev
mug demo enable employee-portal --as demo@example.com --notify dev --sms-to +15551234567

# 3. Share the root URL with stakeholder — they see home screen → surfaces
# https://my-workspace.mug.work/

# 4. When done, disable both
mug demo disable _home
mug demo disable employee-portal
```
