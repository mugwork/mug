---
name: agent
description: Build a custom AI agent — autonomous multi-step work with tools, brain memory, skills, and structured output. Scaffolds the agent folder with agent.json, SOUL.md, and skills.
argument-hint: "<what the agent should do>"
---

# Build a Custom AI Agent

Create an autonomous AI agent that runs multi-step work with tools, memory, and structured output. Each agent is a folder in `agents/<name>/` with config, instructions, and skills. Invoked from workflows via `ctx.agent()`.

For full API reference, see `.mug/docs/agents.md`. For workflow integration, see the `/workflow` skill.

## Input

Description of what the agent should do: `$ARGUMENTS`

If no argument provided, ask the user:
- What task? (analyze data, generate reports, process requests, classify items)
- What data does it need? (workspace databases, external APIs, files)
- Should it remember things across sessions? (memory: true enables logs, journal, mantra)
- Any safety constraints? (max turns, credit limits, approval requirements)

## Step 1 — Design the agent

Based on the user's description, decide:

1. **Name** — kebab-case, descriptive (e.g., `invoice-analyzer`, `support-responder`)
2. **Model** — fixed (`"claude-sonnet"`) or dynamic routing (`{ "fast": "claude-haiku", "balanced": "claude-sonnet", "powerful": "claude-opus" }`)
3. **Tools** — what workspace capabilities it needs:
   - `query` — read-only SQL against workspace databases
   - `search` — semantic similarity search against synced data
   - `ask` — natural language Q&A against databases
   - `notify` — send email/SMS notifications
   - `http` — call external APIs
   - `workspace` — read/write workspace files
   - `ai` — sub-AI calls for classify/extract/summarize within a turn
   - `trigger_workflow` — trigger other workflows (requires `workflows` allowlist in config)
4. **Workflows** — when using `trigger_workflow`, list the allowed workflow names in `workflows: [...]`
5. **Memory** — `true` to enable brain (logs, journal, mantra). When enabled, the agent gets `struggle` and `recall` tools, plus a 3-step close phase at session end (session log → journal → mantra).
6. **Caps** — `maxTurns` (default 50), `maxCredits` (default 500), `maxDuration` (default 300s)
7. **Approval** — which tools need human approval before execution
8. **Chat** — `true` to make the agent conversational via Slack DMs. Auto-wires messagesTab on the Slack app. Each user gets a persistent session — the agent remembers context across messages
9. **Email** — create `email.json` in the agent's folder to give it an email address. Inbound emails pass through deterministic filters, then the agent classifies and acts based on category-specific prompts

## Step 2 — Create the agent folder

Create `agents/<name>/agent.json`:

```json
{
  "name": "<name>",
  "model": "claude-sonnet",
  "tools": ["query", "notify"],
  "memory": true,
  "caps": { "maxTurns": 30, "maxCredits": 200, "maxDuration": 300 },
  "requireApproval": ["notify"],
  "chat": true
}
```

For dynamic model routing (Mug picks fast/balanced/powerful per turn):

```json
{
  "model": {
    "fast": "claude-haiku",
    "balanced": "claude-sonnet",
    "powerful": "claude-opus"
  }
}
```

## Step 3 — Write SOUL.md

Create `agents/<name>/SOUL.md`. This is the agent's core identity and instructions — the human-authored soul, always loaded into the system prompt:

```markdown
# <Agent Name>

You are a <role description> for <workspace context>.

## What you do
<clear description of the agent's purpose and scope>

## How you work
1. <step-by-step approach>
2. <data sources to query>
3. <decisions to make>

## Rules
- <constraints and boundaries>
- Always deliver results via deliver_output
```

## Step 4 — Enable email (optional)

Create `agents/<name>/email.json` to give the agent an email address:

```json
{
  "enabled": true,
  "address": "dispatch",
  "filter": {
    "allowDomains": ["client.com", "internal.com"],
    "blockDomains": ["spam.com"],
    "requireSubject": true
  },
  "categories": [
    {
      "name": "scheduling",
      "prompt": "Process this scheduling request. Look up the customer, check available slots, confirm or propose alternatives.",
      "reply": true
    },
    {
      "name": "quote-request",
      "prompt": "Extract job details from the email. Create a draft quote using the pricing database.",
      "reply": true
    }
  ],
  "fallback": "ignore"
}
```

- `address` — local part of the email address (defaults to agent name). The full address is `address@workspace-domain`
- `filter` — deterministic pre-filter rules evaluated before any AI call (zero cost). `allowDomains` whitelists sender domains, `blockDomains` blocks them, `requireSubject` rejects emails with no subject
- `categories` — named categories with per-category prompt and reply control. The agent classifies each inbound email as one of these categories, then follows that category's prompt. Set `reply: true` for categories where the agent should email back
- `fallback` — what happens when no category matches: `"ignore"` (default) or a custom prompt string

The agent self-classifies inbound email — no platform pre-classification. If the agent needs to trigger complex workflows, it uses `trigger_workflow` (requires the tool in agent.json).

Thread context: the agent automatically receives prior email exchanges from the same thread via In-Reply-To header matching. Past email sessions are logged and queryable.

## Step 5 — Add skills (optional)

Create agent-specific skills at `agents/<name>/skills/<skill-name>/SKILL.md`:

```markdown
---
description: <what this skill teaches the agent>
---

# <Skill Title>

<domain knowledge, procedures, reference data>
```

Shared skills for all agents go in `agents/shared-skills/<skill-name>/SKILL.md`.

Skills are auto-discovered — the agent gets a registry of available skills at session start and loads them on demand via `load_skill`.

## Step 5 — Wire into a workflow

The agent needs a workflow to invoke it:

```typescript
const result = await ctx.agent("<name>", {
  goal: "Analyze the latest invoices and flag overdue ones",
  context: { customerId: "abc123" },
  caps: { maxTurns: 10 },
});

if (result.capped) {
  // Agent hit resource limits — result.output has partial results
}

// result.output has the structured data from deliver_output
// result.usage has { credits, turns, duration }
```

### Router agent pattern

Build a meta-workflow where an agent triages tasks and dispatches to specialized workflows:

```json
{
  "name": "dispatcher",
  "model": "claude-sonnet",
  "tools": ["query", "trigger_workflow"],
  "workflows": ["invoice-followup", "late-payment-escalation", "schedule-appointment"]
}
```

```typescript
// In the parent workflow:
const result = await ctx.agent("dispatcher", {
  goal: "A customer called about their overdue invoice #1234. Route to the right workflow.",
  context: { customerId: "abc123", invoiceId: "1234" },
});
```

The agent queries the database, understands the situation, and triggers the appropriate workflow with context about why it chose that route. The triggered workflow gets its own run, own operation cap, and own log entry.

## Step 6 — Deploy and test

```bash
mug deploy
```

Deploy validates agent.json, writes SOUL.md + skills to the agent runtime, and creates an empty BRAIN.db on first deploy.

Test the agent from the CLI:
```bash
mug invoke <name> "your goal or question"         # one-shot invocation (auto-routes: dev server → production)
mug invoke <name> "your goal or question" --cloud  # force production
mug invoke <name> "your goal or question" --local   # force dev server
mug chat <name>                                    # interactive chat session (Ctrl+C to exit)
```

After the agent runs, pull its brain to see what it learned:
```bash
mug pull agents/<name>              # download brain, export MANTRA.md
cat agents/<name>/MANTRA.md         # read the agent's self-authored narrative
```

## Brain memory

When `memory: true`, the agent gets three tables in BRAIN.db:
- **logs** — session narratives and struggles
- **journal** — end-of-session reflections written when the agent learns something noteworthy
- **mantra** — single-row narrative the agent maintains as its self-authored soul

The agent gets 2 tools automatically:
- `struggle(description)` — signal knowledge gaps for admin review
- `recall(query)` — search memory across logs, journal, and mantra

The brain also auto-detects struggles: cap hits, approval rejections, and fallback responses are logged without the agent needing to do anything.

### Harness lifecycle

At session start, the agent receives SOUL.md + its mantra + skill registry in the system prompt.

At session end, the harness runs a 3-step close phase:
1. Summarize what you worked on (session log — always written)
2. Consider writing a journal entry (if it learned something)
3. Consider updating its mantra (if its understanding changed)

Step 1 is always written. Steps 2 and 3 are forced considerations, not forced writes — the agent decides.

### MANTRA.md

The mantra is the agent's self-authored narrative — what it knows, what it's learned, patterns it's noticed. It lives in BRAIN.db and is exported to `agents/<name>/MANTRA.md` by `mug pull`. The developer can edit MANTRA.md to correct or seed the agent's knowledge, then `mug push` merges it back.

## Human-in-the-loop approval

When `requireApproval` lists tool names, the agent pauses before executing:

```typescript
const result = await ctx.agent("ops-assistant", {
  goal: "Review tickets and notify overdue ones",
  sessionKey: "ticket-review",
});

if (result.status === "pending_approval" && result.pendingApproval) {
  await ctx.agent("ops-assistant", { goal: "Continue — approved", sessionKey: "ticket-review" });
}
```

## Key differences from ctx.ai()

| | `ctx.ai()` | `ctx.agent()` |
|---|---|---|
| Scope | Single prompt → single response | Multi-turn autonomous work |
| Tools | None | query, search, ask, notify, http, workspace, ai, trigger_workflow |
| Memory | Stateless | Brain: logs, journal, mantra |
| Output | Raw text | Structured via deliver_output |
| Cost control | Token limit | Turn/credit/duration caps |
| Use case | Transform, classify, generate | Analyze, investigate, process |
