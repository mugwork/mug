---
name: ai
description: Add AI to a workflow — smart model routing, multi-provider support, BYOK billing. Helps pick the right model tier and billing config.
argument-hint: "<what the AI step should do>"
---

# Add AI to a Workflow

Add an AI-powered step to a workflow using `ctx.ai()`. Smart routing automatically picks the cheapest model that handles the task well. Multi-provider support lets you route to OpenAI, Anthropic, Workers AI, or any Cloudflare AI Gateway provider. BYOK lets you bring your own API key for unlimited AI.

For full API reference (all parameters, architecture, model catalog, error handling), see `.mug/docs/ai.md`. For workflow setup, see the `/workflow` skill.

## Input

Description of what the AI step should do: `$ARGUMENTS`

If no argument provided, ask the user:
- What task? (classify, extract, summarize, analyze, generate text, complex reasoning)
- What data does it work with? (tickets, invoices, emails, reports)
- How precise does the output need to be? (exact category vs open-ended text)
- Volume? (1 call per run vs hundreds — affects cost optimization)

## Step 1 — Pick the approach

Based on the task, recommend the right tier. **You set the `prompt` (user message) and `system` (system prompt) — these control what the AI does.**

| Task | Model tier | Why |
|------|------------|-----|
| Classify into categories | `"fast"` + `maxTokens: 10` | Cheapest, constrained output |
| Extract structured data | `"fast"` | Cheap, pair with a JSON system prompt |
| Summarize long text | `"balanced"` | Mid-tier handles comprehension |
| Analyze and compare | `"balanced"` or `"powerful"` | Depends on complexity |
| Generate text/content | `"balanced"` | Mid-tier for most generation |
| Complex reasoning | `"powerful"` | Strongest model |

Present the recommendation and wait for user confirmation.

## Step 2 — Write the AI step

Add the `ctx.ai()` call to the workflow. Follow these patterns:

### Classification

```typescript
const result = await ctx.ai("fast", {
  prompt: `Classify this ${itemType}:\n\n${item.text}`,
  system: "Reply with exactly one word: billing, technical, or general.",
  maxTokens: 10,
});
const category = result.text.trim().toLowerCase();
```

### Extraction

```typescript
const result = await ctx.ai("fast", {
  prompt: `Extract the following from this email:\n\n${email.body}\n\nReturn JSON: { "name": "", "email": "", "issue": "" }`,
  system: "Return valid JSON only. No other text.",
  maxTokens: 200,
});
const extracted = JSON.parse(result.text);
```

### Summarization

```typescript
const result = await ctx.ai("balanced", {
  prompt: `Summarize this report in 2-3 sentences:\n\n${report.body}`,
  system: "Be concise. Focus on key findings and actions.",
  maxTokens: 200,
});
```

### Analysis

```typescript
const result = await ctx.ai("balanced", {
  prompt: `Analyze these metrics and identify the top 3 issues:\n\n${JSON.stringify(metrics)}`,
  system: "Be specific. Reference actual numbers. Prioritize by impact.",
  maxTokens: 500,
});
```

### Complex reasoning

```typescript
const result = await ctx.ai("powerful", {
  prompt: `Given this context:\n${context}\n\nEvaluate whether we should ${decision}. Consider risks, costs, and timeline.`,
  system: "Think step by step. Weigh pros and cons. End with a clear recommendation.",
  maxTokens: 1000,
});
```

### Decision making (structured)

```typescript
const result = await ctx.ai("fast", {
  prompt: `Should this expense be approved?\n\nAmount: $${expense.amount}\nCategory: ${expense.category}\nPolicy limit: $${policy.limit}\nBudget remaining: $${budget.remaining}`,
  system: "Reply with JSON: { \"approved\": true/false, \"reason\": \"one sentence\" }",
  maxTokens: 50,
});
const decision = JSON.parse(result.text);
```

## Step 3 — Optimize cost

**Set `maxTokens` tight.** Default is 1024. If you expect a one-word answer, set it to 10. This affects routing — low maxTokens biases toward the fast tier.

**Use tier names directly** — `"fast"` for classification/extraction, `"balanced"` for summarization/analysis, `"powerful"` for complex reasoning. More predictable than `"auto"`.

**Check `result.routing`** during development to verify the tier selection:
```typescript
const result = await ctx.ai("fast", { prompt, system: "Reply with one word.", maxTokens: 10 });
console.log(result.routing);
// { tier: "fast", model: "gpt-5.4-nano", provider: "openai", reason: "tier:fast" }
```

## Step 4 — Configure BYOK (optional)

For unlimited AI without consuming Mug credits, bring your own API key:

```bash
mug secret set ai.anthropic=sk-ant-xxx
```

Then configure which tiers use your key in `mug.json`:

```json
{
  "ai": {
    "billing": {
      "fast": "mug-metered",
      "balanced": "mug-metered",
      "powerful": "ai.anthropic"
    }
  }
}
```

Or set billing per-workflow:
```typescript
workflow("expensive-analysis", handler, { billing: "ai.anthropic" });
```

Or per-call:
```typescript
await ctx.ai("powerful", { prompt, system: "...", billing: "ai.anthropic" });
```

## Feature Catalog

### Tier names (`"fast"`, `"balanced"`, `"powerful"`)
Pick the tier directly — uses your workspace's configured model for that tier. `"fast"` = cheapest (default: gpt-5.4-nano). `"balanced"` = mid-tier (default: kimi-k2.6). `"powerful"` = strongest (default: claude-sonnet-4-6). **Recommended approach.** Response includes `routing: { tier, model, provider, reason }`.

### Auto routing (`"auto"`)
Mug picks the tier based on prompt complexity. Uses token count, keyword markers, and maxTokens. Less predictable than choosing the tier yourself — prefer explicit tier names.

### Multi-provider models
Any Cloudflare AI Gateway model: `"openai/gpt-5.4-nano"`, `"anthropic/claude-sonnet-4-6"`, `"@cf/moonshotai/kimi-k2.6"`. Configure defaults per tier in `mug.json` `ai.routing`. Override per-call with `routing: { fast: "...", balanced: "..." }`.

### BYOK billing
Store your key with `mug secret set ai.<provider>=<key>`. Reference in `mug.json` `ai.billing` per tier, or override per-call/per-workflow with `billing: "ai.anthropic"`. Zero Mug credit consumption.

### Legacy model aliases
`"haiku"`, `"sonnet"`, `"opus"` still work — mapped to Anthropic models. Prefer tier names for new code.

### Per-call routing overrides
```typescript
await ctx.ai("powerful", {
  prompt,
  system: "...",
  routing: { powerful: "anthropic/claude-opus-4-7" },
});
```
### Direct provider call
Skip smart routing entirely:
```typescript
await ctx.ai("openai/gpt-4.1", { prompt, system });
```

## Complete Example

```typescript
import { workflow } from "@mugwork/mug";

workflow("lead-scoring", async (ctx) => {
  const leads = await ctx.query("crm", `
    SELECT id, name, email, company, notes, source
    FROM leads WHERE scored_at IS NULL LIMIT 50
  `);

  let hot = 0, warm = 0, cold = 0;

  for (const lead of leads) {
    const score = await ctx.ai("fast", {
      prompt: `Score this lead as hot, warm, or cold:\n\nName: ${lead.name}\nCompany: ${lead.company}\nSource: ${lead.source}\nNotes: ${lead.notes}`,
      system: "Reply with exactly one word: hot, warm, or cold. Hot = ready to buy. Warm = interested. Cold = unlikely.",
      maxTokens: 5,
    });

    const tier = score.text.trim().toLowerCase();
    if (tier === "hot") hot++;
    else if (tier === "warm") warm++;
    else cold++;

    await ctx.exec("crm", "UPDATE leads SET score = ?, scored_at = datetime('now') WHERE id = ?",
      [tier, lead.id as number]);

    // Hot leads get a personalized outreach draft
    if (tier === "hot") {
      const draft = await ctx.ai("balanced", {
        prompt: `Write a brief, personalized outreach email for:\n\nName: ${lead.name}\nCompany: ${lead.company}\nNotes: ${lead.notes}`,
        system: "Keep it under 100 words. Professional but warm. Reference something specific from their notes.",
        maxTokens: 200,
      });

      await ctx.notify.email({
        to: "sales@company.com",
        subject: `Hot lead: ${lead.name} (${lead.company})`,
        message: `**Score:** ${tier}\n\n**Draft outreach:**\n\n${draft.text}`,
      });
    }
  }

  return { scored: leads.length, hot, warm, cold };
});
```
