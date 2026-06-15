# Agents API Reference

Custom AI agents run autonomous multi-step work with tools, brain memory, and structured output. Unlike `ctx.ai()` (single prompt → single response), agents iterate over multiple turns with tool access and persistent memory.

## Agent Folder Structure

Each agent is a folder in `agents/<name>/`:

```
agents/
├── shared-skills/                    # skills available to all agents
│   └── skill-name/SKILL.md
├── dispatch-bot/
│   ├── agent.json                    # config
│   ├── SOUL.md                       # core identity + instructions (human-authored)
│   ├── MANTRA.md                     # self-knowledge narrative (agent-authored, exported by mug pull)
│   ├── skills/                       # agent-specific skills
│   │   └── scheduling-rules/SKILL.md
│   └── BRAIN.db                      # persistent memory (runtime-managed)
```

## agent.json

```json
{
  "name": "dispatch-bot",
  "model": "claude-sonnet",
  "tools": ["query", "search", "notify"],
  "memory": true,
  "caps": { "maxTurns": 30, "maxCredits": 200, "maxDuration": 300 },
  "requireApproval": ["notify"]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Agent identifier (defaults to folder name) |
| `model` | string or object | Fixed model (`"claude-sonnet"`) or dynamic routing (see below) |
| `instructions` | string | Path to instruction file relative to agent folder (default: `"SOUL.md"`) |
| `tools` | string[] | Workspace capabilities to grant (see Tool Grants) |
| `workflows` | string[] | Workflows this agent can trigger (required when `trigger_workflow` is in tools) |
| `memory` | boolean | Enable brain memory (logs, journal, mantra) and harness lifecycle |
| `caps` | object | Resource limits per session |
| `requireApproval` | string[] | Tools that pause for human approval |

### Model Options

**Fixed model** — one model for all turns:
```json
{ "model": "claude-sonnet" }
```

**Dynamic routing** — Mug picks the tier per turn based on complexity:
```json
{
  "model": {
    "fast": "claude-haiku",
    "balanced": "claude-sonnet",
    "powerful": "claude-opus"
  }
}
```

You can assign 2 or 3 tiers. Any combination works: `fast`+`balanced`, `balanced`+`powerful`, or all three.

Available models: `claude-sonnet`, `claude-haiku`, `claude-opus`, `gpt-4o`, `gpt-4o-mini`, `gpt-4.1-nano`, `gpt-4.1-mini`, `gpt-4.1`, or any `provider/model` string for AI Gateway routing.

## SOUL.md

The agent's core identity and instructions — the human-authored soul. Always loaded into the system prompt. Write this as a markdown file in the agent folder:

```markdown
# Dispatch Bot

You are a dispatch coordinator for an HVAC company.

## What you do
Assign incoming service requests to available technicians based on location, skills, and schedule.

## How you work
1. Query the service requests database for unassigned tickets
2. Check technician availability and zone assignments
3. Match requests to the best available technician
4. Notify the technician and update the ticket

## Rules
- Never double-book a technician
- Emergency calls override scheduled maintenance
- Always deliver results via deliver_output
```

## MANTRA.md

The agent's self-authored soul — a narrative the agent writes and maintains based on what it learns over time. MANTRA.md is a **local-only derived artifact**: it doesn't exist on the remote, it's exported from BRAIN.db when you run `mug pull`.

The agent's mantra is injected into the system prompt alongside SOUL.md at every session start. Together they form the complete agent identity: SOUL.md is who you are (human-authored), the mantra is what you know (agent-authored).

```
mug pull agents/dispatch-bot     # export MANTRA.md from production BRAIN.db
cat agents/dispatch-bot/MANTRA.md  # read what the agent learned
# edit to correct or seed knowledge
mug push agents/dispatch-bot     # merge edits back to production
```

## Skills

Agent-specific skills live in `agents/<name>/skills/<skill-name>/SKILL.md`. Shared skills for all agents live in `agents/shared-skills/<skill-name>/SKILL.md`.

Skills are auto-discovered from the folder structure. At session start, the agent receives a registry of available skills (names + descriptions). The agent loads full skill content on demand via the `load_skill` tool.

SKILL.md format:
```markdown
---
description: Service territory zones and boundaries for technician routing
---

# Service Territories

Zone 1: Downtown core (zip codes 10001-10010)
...
```

## Tool Grants

| Grant | Tools provided | Description |
|-------|---------------|-------------|
| `query` | `query(database, sql)` | Read-only SQL against workspace databases |
| `search` | `search_data(query, source?, limit?)` | Semantic similarity search against synced data |
| `ask` | `ask_question(question, source?)` | Natural language Q&A (search + AI synthesis) |
| `notify` | `send_email(to, subject, message)`, `send_sms(to, message)` | Send notifications |
| `http` | `http_request(url, method, body, headers)` | External API calls |
| `workspace` | Read/write workspace files | File access in agent sandbox |
| `ai` | `ai_call(prompt, system?, model?, maxTokens?)` | Sub-AI calls (credits count against caps) |
| `trigger_workflow` | `trigger_workflow(workflow, params?, context?, wait?)` | Trigger other workflows (requires `workflows` allowlist) |

The `deliver_output(result)` tool is always available. When `memory: true`, brain tools and `load_skill` are auto-enabled.

### trigger_workflow

When granted, the agent can trigger other workflows in the workspace. Requires a `workflows` allowlist in agent config — the agent can only trigger workflows explicitly listed.

```json
{
  "name": "dispatcher",
  "model": "claude-sonnet",
  "tools": ["query", "trigger_workflow"],
  "workflows": ["invoice-followup", "late-payment-escalation", "schedule-appointment"]
}
```

The tool description dynamically lists available workflows so the agent understands its routing options.

**Wait mode** (default): The agent triggers the workflow and waits for it to complete. Returns the workflow result, status, duration, and step count. Use when the agent needs to reason about the outcome.

**Fire-and-forget** (`wait: false`): The agent triggers the workflow and continues immediately. The workflow runs asynchronously via Cloudflare Workflows with durable execution. Use for background tasks the agent doesn't need to monitor.

The optional `context` string passes the agent's reasoning to the triggered workflow — e.g., "45 days overdue, two ignored emails, escalate aggressively." If the triggered workflow calls its own `ctx.agent()`, this context flows downstream naturally via the params.

## Brain Memory

When `memory: true`, the agent gets a persistent memory system backed by BRAIN.db (SQLite in the Think DO). The brain has three tables:

### Three tables

| Table | Purpose | Written by |
|-------|---------|-----------|
| **logs** | Operational records — facts, outcomes, struggles | Agent (via tools) + harness (auto-detected) |
| **journal** | End-of-session reflections — insights, patterns, hypotheses | Agent (harness-prompted) |
| **mantra** | Single-row self-authored narrative — synthesized self-knowledge | Agent (harness-prompted) |

### Memory tools

When memory is enabled, the agent gets these tools automatically:

**`remember(content, entity?)`** — Store a fact. Optionally name the person, company, or thing it's about.

**`track(action, result, worked?)`** — Record what the agent did and what happened. The `worked` flag tracks effectiveness.

**`struggle(description)`** — Flag something the agent couldn't do or didn't know. The admin reviews these to improve skills and instructions.

**`recall(query)`** — Search across logs, journal, and mantra for relevant context.

**`load_skill(name)`** — Load full content of a skill from the registry.

### Auto-detected struggles

The runtime automatically logs to the brain without agent cooperation:
- **cap_hit** — agent reached maxTurns, maxCredits, or maxDuration
- **correction** — admin rejected an approval request
- **fallback** — agent delivered output with no structured data

### Harness lifecycle

The harness enforces a session lifecycle on every agent invocation:

**Session start:**
1. SOUL.md injected into system prompt (agent can't skip it)
2. Mantra injected after SOUL.md (agent's self-knowledge from prior sessions)
3. Skill registry appended (names + descriptions, loaded on demand)
4. Brain tools enabled (remember, track, struggle, recall)

**Mid-session:**
- Agent uses tools as needed — brain tools for memory, granted tools for work
- Auto-struggle detection on cap hits, corrections, fallbacks

**Session end (close phase):**
1. Harness prompts: "Did you learn anything worth journaling?" → agent writes a journal entry or skips
2. Harness prompts: "Review your mantra — still accurate?" → agent updates mantra or skips

Both prompts are forced considerations, not forced writes. The agent decides whether to write. If the agent is at its cap, the close phase is skipped (auto-struggle logged).

### Admin workflow

The consultant reviews the agent's brain and improves it:

```bash
mug pull agents/dispatch-bot        # download brain, export MANTRA.md
cat agents/dispatch-bot/MANTRA.md   # read what the agent learned
# update SOUL.md or add skills based on what the agent struggled with
mug push agents/dispatch-bot        # push improvements (merges MANTRA.md edits too)
mug deploy                          # deploy updated agent
```

## Workflow Integration

### `ctx.agent(name, options)`

```typescript
const result = await ctx.agent("dispatch-bot", {
  goal: string,                        // what the agent should accomplish
  context?: Record<string, unknown>,   // contextual data passed to the agent
  sessionKey?: string,                 // custom session key for resume
  caps?: {                             // per-invocation cap overrides
    maxTurns?: number,
    maxCredits?: number,
    maxDuration?: number,
  },
});
```

### AgentResult

```typescript
interface AgentResult {
  response: string;                    // agent's text response
  output?: Record<string, unknown>;    // structured output from deliver_output
  usage: {
    credits: number;
    turns: number;
    duration: number;
  };
  capped?: boolean;
  cappedReason?: string;               // "turn_limit" | "credit_limit" | "duration_limit"
  status?: string;                     // "complete" | "pending_approval"
  pendingApproval?: {
    tool: string;
    args: Record<string, unknown>;
  };
}
```

## Human-in-the-Loop Approval

When `requireApproval` lists tool names, the agent pauses before executing those tools.

```typescript
const result = await ctx.agent("ops-assistant", {
  goal: "Review tickets and send reminders",
  sessionKey: "weekly-review",
});

if (result.status === "pending_approval" && result.pendingApproval) {
  const { tool, args } = result.pendingApproval;

  // Option A: auto-approve
  await ctx.agent("ops-assistant", { goal: "Continue — approved", sessionKey: "weekly-review" });

  // Option B: human approval via email
  const callbackUrl = await ctx.waitForUrl("agent-approval");
  await ctx.notify.email({
    to: "manager@company.com",
    subject: `Agent wants to ${tool}`,
    message: `**Tool:** ${tool}\n**Args:** ${JSON.stringify(args)}`,
    cta: { label: "Approve", url: `${callbackUrl}?action=approve` },
  });
  const event = await ctx.waitFor("agent-approval", { timeout: "24 hours" });
  if (!event.timedOut && event.payload?.action === "approve") {
    await ctx.agent("ops-assistant", { goal: "Continue — approved", sessionKey: "weekly-review" });
  }
}
```

## Cap Enforcement

When any cap is reached:
- Agent is forced to call `deliver_output` with partial results
- `result.capped` is `true`, `result.cappedReason` explains why
- A `cap_hit` struggle is auto-logged to the brain
- Close phase (journal + mantra) is skipped

## Deploy

`mug deploy` validates agent.json and provisions each agent:
1. Reads `agent.json` from each folder in `agents/`
2. Validates model, tools, caps
3. Reads SOUL.md content and skill files (agent-specific + shared)
4. Writes config + instructions + skills to the agent runtime
5. Creates empty BRAIN.db on first deploy (subsequent deploys preserve brain data)

## Example

`agents/invoice-analyzer/agent.json`:
```json
{
  "name": "invoice-analyzer",
  "model": "claude-sonnet",
  "tools": ["query", "notify"],
  "memory": true,
  "caps": { "maxTurns": 20, "maxCredits": 100 },
  "requireApproval": ["notify"]
}
```

`agents/invoice-analyzer/SOUL.md`:
```markdown
# Invoice Analyzer

You analyze overdue invoices and draft reminder notifications.

## How you work
1. Query the invoices database for overdue items
2. Classify urgency based on amount and days overdue
3. Draft appropriate reminder (email for low urgency, SMS for high)
4. Remember customer payment patterns for future reference

## Rules
- Always check your memory for customer history before drafting
- Flag a struggle if you encounter an invoice type you don't recognize
- Deliver a summary with overdue count, total amount, and actions taken
```

`workflows/weekly-invoice-review.ts`:
```typescript
export default async function run(ctx) {
  const result = await ctx.agent("invoice-analyzer", {
    goal: "Review all invoices from the past week. Flag overdue ones and draft reminder emails.",
    context: { overdueThreshold: 30 },
  });

  if (result.output?.overdueCount > 0) {
    await ctx.notify.email({
      to: "finance@company.com",
      subject: `${result.output.overdueCount} overdue invoices found`,
      message: result.response,
    });
  }
}
```
