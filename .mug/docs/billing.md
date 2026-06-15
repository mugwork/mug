# Billing & Usage — Full Reference

Mug workspaces are billed per-workspace with flat tiers plus usage overages. Every workspace starts on the Free tier.

## Tiers

| Tier | Price | Operations | Records | Storage | Email | SMS | AI Credits |
|------|-------|-----------|---------|---------|-------|-----|------------|
| Free | $0 | 20,000/mo | 10,000 | 100 MB | 100/mo | 50/mo | 2,500/mo |
| Starter | $99/mo | 1,000,000/mo | 250,000 | 5 GB | 1,500/mo | 500/mo | 15,000/mo |
| Pro | $299/mo | 10,000,000/mo | 2,500,000 | 50 GB | 5,000/mo | 1,000/mo | 50,000/mo |
| Business | $599/mo | 50,000,000/mo | 25,000,000 | 500 GB | 15,000/mo | 2,500/mo | 100,000/mo |

Annual billing: 2 months free (~17% off). Volume discounts: 10-25% for multi-workspace accounts.

## Six billing dimensions

1. **Operations** — workflow step executions. Metered but not hard-blocked (soft limit with alerts).
2. **Database records** — total rows across all workspace databases. Reconciled periodically.
3. **File storage** — total bytes in `files/` (R2). Checked before upload.
4. **Email sends** — emails sent via `ctx.notify.email()`. Hard limit — returns error when exceeded.
5. **SMS sends** — SMS sent via `ctx.notify.sms()`. Hard limit — returns error when exceeded.
6. **AI credits** — `Math.ceil(tokens / 1000)` per AI call. BYOK calls don't consume credits. Hard-blocked when remaining = 0.

## What happens at the limit

When a dimension reaches its limit:

- **Email/SMS**: `ctx.notify.email()` and `ctx.notify.sms()` throw with `"Usage limit exceeded for email: 100/100"`. Catch this in workflows to handle gracefully.
- **AI credits**: `ctx.ai()` throws with `"AI credit limit exceeded: 2500/2500"` when credits are fully consumed. BYOK calls (`billing: "ai.anthropic"`) bypass this entirely.
- **File storage**: File uploads return a 429 error when storage is full.
- **Operations**: Metered but not blocked — workflows continue running. Alerts fire at 80% and 100%.
- **Database records**: Reconciled periodically. Not blocked in real-time.

Workspace owners receive email alerts at **80%** and **100%** of each dimension's base allotment.

## Overages

Paid tiers can enable per-unit overage billing on each meter independently. When usage exceeds the base allotment, overage charges accrue at per-unit rates and appear on your next invoice.

- **Toggle per meter**: enable or disable overages for each dimension at `mug.work/workspace/<name>`
- **Dollar cap per meter**: set a spending cap — usage is blocked when the cap is reached
- **Default cap**: Starter $20/mo, Pro $70/mo, Business $150/mo per meter (adjustable)

Free tier has hard caps only — no overage option. Upgrade first.

## Schedule interval enforcement

Each tier has a minimum schedule interval. Schedules configured below the floor are **silently clamped** on deploy:

| Tier | Min interval |
|------|-------------|
| Free | Daily (once per day) |
| Starter | 15 minutes |
| Pro | 5 minutes |
| Business | 1 minute |

If you set `"schedule": "*/5 * * * *"` on a Free tier workspace, it deploys as `"0 0 * * *"` (daily). The deploy response includes clamped schedule info. Upgrade the tier to unlock shorter intervals.

## BYOK — Bring Your Own Keys

BYOK lets you use your own API keys for AI, email, and SMS. BYOK usage **does not count** against Mug billing dimensions.

```bash
# AI — zero credit consumption
mug secret set ai.anthropic=sk-ant-...
mug secret set ai.openai=sk-...

# Email — zero email send consumption
mug secret set RESEND_API_KEY=re_...

# SMS — zero SMS send consumption
mug secret set TWILIO_ACCOUNT_SID=AC...
mug secret set TWILIO_AUTH_TOKEN=...
mug secret set TWILIO_PHONE_NUMBER=+1...
```

Configure BYOK billing in `mug.json`:
```json
{
  "ai": {
    "billing": {
      "default": "ai.anthropic",
      "fast": "mug-metered",
      "powerful": "ai.anthropic"
    }
  }
}
```

Per-call: `ctx.ai("auto", { prompt, billing: "ai.anthropic" })`. Per-workflow: `workflow("name", handler, { billing: "ai.anthropic" })`.

## CLI commands

```bash
mug usage                            # view all 6 dimensions with progress bars
mug usage --period 2026-04           # view a past billing period
mug usage --json                     # structured output

mug workspace plan                   # view or change plan tier (opens Stripe Checkout for paid tiers)

mug billing                              # view plan, email, per-meter overage status + caps
mug billing --overage operations=on      # toggle overage on for a meter
mug billing --overage sms=off            # toggle overage off (hard cap at plan limit)
mug billing --cap ai_credits=50          # set overage cap to $50/mo for a meter
mug billing --email billing@co.com       # set billing notification email
```

## Handling limit errors in workflows

```typescript
workflow("bulk-notify", async (ctx) => {
  const customers = await ctx.query("crm", "SELECT * FROM customers WHERE _mug_deleted_at IS NULL");
  let sent = 0, skipped = 0;

  for (const c of customers) {
    try {
      await ctx.notify.email({
        to: c.email as string,
        subject: "Monthly Update",
        message: "Your latest report is ready.",
      });
      sent++;
    } catch (e) {
      if ((e as Error).message.includes("Usage limit exceeded")) {
        skipped = customers.length - sent;
        break; // stop sending — limit reached
      }
      throw e;
    }
  }

  return { sent, skipped };
});
```
