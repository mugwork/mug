# AI — Full API Reference

Mug provides AI capabilities via `ctx.ai()` in workflows. Smart routing automatically picks the best model for each task. Multi-provider support routes to OpenAI, Anthropic, Workers AI, or any Cloudflare AI Gateway provider. BYOK (Bring Your Own Key) lets you use your own API keys for unlimited AI at zero Mug credit cost.

For a guided walkthrough, use the `/ai` skill. For the full WorkspaceContext API, see [api.md](api.md).

## ctx.ai(model, options)

```typescript
async ai(
  model: string,
  options: {
    prompt: string;
    system?: string;
    maxTokens?: number;       // default: 1024
    routing?: RoutingConfig;   // per-call model overrides
    billing?: string;          // "mug-metered" or BYOK key name
  }
): Promise<{
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  routing?: {
    tier: "fast" | "balanced" | "powerful";
    model: string;
    provider: string;
    reason: string;
  };
}>
```

### Model parameter

The `model` parameter accepts four formats:

| Format | Example | Behavior |
|--------|---------|----------|
| Tier name | `ctx.ai("fast", { prompt, system })` | Uses workspace's configured model for that tier — **recommended** |
| `"auto"` | `ctx.ai("auto", { prompt, system })` | Mug picks the tier based on prompt complexity |
| `"provider/model"` | `ctx.ai("openai/gpt-5.4-nano", { prompt, system })` | Direct — calls a specific provider and model |
| Legacy alias | `ctx.ai("sonnet", { prompt, system })` | Backwards-compatible — resolves to `anthropic/claude-sonnet-4-6` |

**Use tier names directly** — pick `"fast"` for classification/extraction, `"balanced"` for summarization/analysis, `"powerful"` for complex reasoning. `"auto"` routing uses prompt heuristics and is less predictable than choosing the tier yourself. The tier resolves to your workspace's configured model in `mug.json` `ai.routing`.

**You must set `prompt` and `system`.** `prompt` is the user message (the data/question). `system` is the system prompt (instructions for how to respond). These are passed directly to the model — you have full control.

## Smart routing

When `model` is `"auto"`, Mug scores the request using three deterministic signals and routes to one of three tiers. Zero overhead — scoring runs in <1ms with no API calls.

### Tiers

| Tier | Default model | Pricing (per 1M tokens) | Use case |
|------|---------------|------------------------|----------|
| **fast** | openai/gpt-5.4-nano | $0.20 in / $1.25 out | Classification, extraction, formatting, simple decisions |
| **balanced** | @cf/moonshotai/kimi-k2.6 | Workers AI neurons | Summarization, analysis, general-purpose, multi-step reasoning |
| **powerful** | anthropic/claude-sonnet-4-6 | $3.00 in / $15.00 out | Complex reasoning, nuanced judgment, code generation |

### Scoring signals

1. **Token count** — estimated from prompt + system prompt length. Longer inputs → higher tier.
2. **Keyword markers** — detects reasoning words ("analyze", "step by step", "compare") and code patterns (triple backticks, function/class definitions). Code → minimum balanced.
3. **maxTokens** — constrained output (≤50) → fast bias. Long output (>2000) → powerful bias.

### Routing response

When using `"auto"`, the response includes a `routing` field:

```typescript
const result = await ctx.ai("auto", {
  prompt: "Classify this ticket as billing, technical, or general",
  system: "Reply with exactly one word: billing, technical, or general.",
  maxTokens: 10,
});
// result.routing = { tier: "fast", model: "gpt-5.4-nano", provider: "openai", reason: "short-prompt,low-maxTokens" }
```

### Per-call routing overrides

Override which models the tiers map to for a specific call:

```typescript
await ctx.ai("balanced", {
  prompt,
  system,
  routing: {
    fast: "anthropic/claude-haiku-4-5",
    balanced: "anthropic/claude-sonnet-4-6",
    powerful: "anthropic/claude-opus-4-7",
  },
});
```

## Multi-provider

Every tier can map to any AI Gateway provider. Use `provider/model` format:

- `"openai/gpt-5.4-nano"` — OpenAI
- `"anthropic/claude-sonnet-4-6"` — Anthropic
- `"@cf/moonshotai/kimi-k2.6"` — Workers AI (runs on Cloudflare, cheapest)
- `"google/gemini-3-flash"` — Google AI Studio

### Workspace defaults (mug.json)

Configure which models your workspace uses for each tier:

```json
{
  "ai": {
    "routing": {
      "fast": "openai/gpt-5.4-nano",
      "balanced": "@cf/moonshotai/kimi-k2.6",
      "powerful": "anthropic/claude-sonnet-4-6"
    }
  }
}
```

Precedence: **per-call `routing` > mug.json `ai.routing` > platform defaults**

## Billing

### mug-metered (default)

By default, all AI calls are billed through Mug's credits via Cloudflare Unified Billing. One Cloudflare invoice, no provider API keys needed. Credits are deducted from your workspace plan allocation.

### BYOK (Bring Your Own Key)

Store your own provider API key and use it for specific tiers. Zero Mug credit consumption — unlimited AI on your own dime.

**Setup:**

```bash
# 1. Store your key
mug secret set ai.anthropic=sk-ant-xxx

# 2. Configure billing in mug.json
```

```json
{
  "ai": {
    "billing": {
      "default": "mug-metered",
      "fast": "mug-metered",
      "balanced": "mug-metered",
      "powerful": "ai.anthropic"
    }
  }
}
```

This routes the powerful tier through your own Anthropic key while fast and balanced stay on Mug credits.

### Per-call and per-workflow billing

Override billing at the call level or workflow level:

```typescript
// Per-call: use a specific key for this step
await ctx.ai("powerful", {
  prompt,
  system,
  billing: "ai.anthropic",
});

// Per-call: force mug-metered even if workspace has BYOK
await ctx.ai("fast", {
  prompt,
  system,
  billing: "mug-metered",
});
```

```typescript
// Per-workflow: all AI calls in this workflow use this key
workflow("sensitive-analysis", async (ctx) => {
  await ctx.ai("balanced", { prompt: "...", system: "..." });
  await ctx.ai("powerful", { prompt: "...", system: "..." });
}, { billing: "ai.anthropic" });
```

Precedence: **per-call `billing` > per-workflow `billing` > mug.json `ai.billing[tier]` > mug.json `ai.billing.default` > `"mug-metered"`**

## Architecture

```
ctx.ai("fast", { prompt, system })
    ↓
Worker: resolve tier → fast
Worker: resolveModel → openai/gpt-5.4-nano
Worker: resolveBilling → "mug-metered"
    ↓
AI Service (Cloudflare Worker)
    ↓
AI Gateway (compat endpoint)
  → Unified Billing (CF_API_TOKEN) or BYOK (Secrets Store key)
  → Per-workspace Dynamic Route: budget limits, rate limits, fallback chains
  → Provider dispatch (OpenAI / Anthropic / Workers AI / etc.)
    ↓
Response: { text, model, usage, routing }
```

- **Unified Billing** — Cloudflare passes through provider pricing at cost. No markup. Mug loads credits into CF, spends across all providers with one invoice.
- **Per-workspace Dynamic Routes** — each workspace gets `dynamic/ws-{workspace}` with budget limits (plan-tiered), rate limits, and fallback chains (fast → balanced → powerful).
- **Analytics Engine** — every call logged with workspace, provider, model, tier, billing type, and token counts.

## Error handling

- **Invalid model**: throws if model name doesn't match any provider format or legacy alias.
- **Rate limits**: AI Gateway retries automatically (2 retries, exponential backoff). If still rate-limited, throws with the provider's error.
- **BYOK key not found**: if the Secrets Store key referenced in billing config doesn't exist, returns an auth error. Fix with `mug secret set <key-name>=<value>`.
- **Budget exceeded**: if the workspace's Dynamic Route budget limit is reached, the gateway returns an error. Purchase overage packs or upgrade your plan.
- **Network errors**: transient failures are retried by the gateway. Persistent failures throw.

All `ctx.ai()` errors can be caught with try/catch:

```typescript
try {
  const result = await ctx.ai("fast", { prompt, system });
} catch (e) {
  console.error(`AI call failed: ${e.message}`);
  // Handle gracefully — skip, retry with different model, etc.
}
```

## Cloudflare AI model catalog

Mug supports any model available through Cloudflare AI Gateway. Key models by provider:

### Anthropic
| Model | Input/1M | Output/1M | Notes |
|-------|----------|-----------|-------|
| claude-opus-4.7 | $5.00 | $25.00 | Most capable, 1M context |
| claude-sonnet-4.6 | $3.00 | $15.00 | **Platform default: powerful tier** |
| claude-haiku-4.5 | $1.00 | $5.00 | Fast, cost-efficient |

### OpenAI
| Model | Input/1M | Output/1M | Notes |
|-------|----------|-----------|-------|
| gpt-5.4-nano | $0.20 | $1.25 | **Platform default: fast tier**. Smallest, fastest |
| gpt-4.1-mini | $0.40 | $1.60 | Fast, 1M context |
| gpt-4.1 | $2.00 | $8.00 | Complex tasks, 1M context |

### Workers AI (@cf/)
| Model | Pricing | Notes |
|-------|---------|-------|
| @cf/moonshotai/kimi-k2.6 | Neurons | **Platform default: balanced tier**. 1T params, 262K context |
| @cf/deepseek-ai/deepseek-r1-distill-qwen-32b | Neurons | Reasoning model |
| @cf/meta/llama-3.1-8b-instruct-fast | Neurons | Fast, lightweight |

### Google
| Model | Input/1M | Output/1M | Notes |
|-------|----------|-----------|-------|
| gemini-3.1-pro | — | — | Most intelligent, 1M context |
| gemini-3-flash | $0.50 | $3.00 | Fast, strong grounding |
| gemini-3.1-flash-lite | — | — | Lightest, most cost-efficient |

For the complete catalog: [Cloudflare AI Models](https://developers.cloudflare.com/ai/models/)

## CLI commands

```bash
mug secret set ai.anthropic=<key>    # Store BYOK key for Anthropic
mug secret set ai.openai=<key>       # Store BYOK key for OpenAI
mug secret list                       # Show configured secrets (including BYOK keys)
mug secret remove ai.anthropic        # Remove a BYOK key
```

## Complete example

```typescript
import { workflow } from "@mugwork/mug";

workflow("daily-ticket-triage", async (ctx) => {
  // Fetch open tickets
  const tickets = await ctx.query("helpdesk", `
    SELECT id, subject, body, customer_email, priority
    FROM tickets WHERE status = 'open'
  `);

  for (const ticket of tickets) {
    // Classify — fast tier (cheap, deterministic)
    const category = await ctx.ai("fast", {
      prompt: `Classify this support ticket:\n\nSubject: ${ticket.subject}\n\n${ticket.body}`,
      system: "Reply with exactly one word: billing, technical, or general.",
      maxTokens: 10,
    });

    // For complex tickets, generate a detailed response
    if (ticket.priority === "high") {
      const response = await ctx.ai("balanced", {
        prompt: `Draft a response to this ${category.text} ticket:\n\n${ticket.body}`,
        system: "Write a helpful, professional response. Be specific and actionable.",
      });

      await ctx.notify.email({
        to: ticket.customer_email as string,
        message: response.text,
        subject: `Re: ${ticket.subject}`,
      });
    }

    // Update ticket
    await ctx.exec("helpdesk", "UPDATE tickets SET category = ?, status = 'triaged' WHERE id = ?",
      [category.text, ticket.id as number]);
  }

  return { triaged: tickets.length };
}, { billing: "ai.anthropic" });  // All AI in this workflow uses BYOK
```

## Search — Three-Layer Model

Mug provides three layers of AI-powered search over synced data. Each layer builds on the previous one — use the simplest layer that solves your problem.

### Layer 1: FTS5 Keyword Search (free, works locally)

Every synced text column automatically gets a full-text search index. No configuration needed — happens during source sync. Query via standard FTS5 SQL:

```typescript
const results = await ctx.query("servicetitan",
  `SELECT j.* FROM jobs j JOIN jobs_fts ON j.rowid = jobs_fts.rowid
   WHERE jobs_fts MATCH ? ORDER BY rank LIMIT 10`,
  ["leak roof"]
);
```

**When to use:** exact keyword matches, simple text search, local dev, free tier.

### Layer 2: ctx.search() — Semantic Similarity (requires deploy)

Natural language search that understands meaning, not just keywords. "roof leak complaints" finds records mentioning "water damage from overhead" even if those exact words don't appear.

```typescript
const results = await ctx.search("customers who complained about water damage", {
  source: "jobs",  // optional: scope to one table
  limit: 10,       // default 10, max 50
});
// Returns: { score, table, primaryKey, row }[]
```

**When to use:** fuzzy matching, semantic queries, finding related records, pre-filtering for agent workflows.

### Layer 3: ctx.ask() — Full RAG (requires deploy)

One-call question answering. Searches for relevant data, feeds it to an LLM, returns a grounded natural language answer with source citations.

```typescript
const result = await ctx.ask("What were the most common complaints last month?", {
  source: "jobs",
  model: "balanced",
  system: "You are an operations analyst for an HVAC company.",
});
// result.answer = "The most common complaints were..."
// result.sources = [{ score, table, primaryKey, row }, ...]
```

**When to use:** natural language questions, generating summaries, answering user queries in agent workflows, any time you need an answer (not just matching records).
