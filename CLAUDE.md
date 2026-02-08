# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Keeping Documentation Synced

**When making changes to this project, you MUST update:**

1. **PLAN.md** - Mark completed tasks, update status, add new tasks if scope changes
2. **TODO.md** - Update priorities and any newly discovered gaps
3. **CLAUDE.md** - Update architecture, commands, or structure if they change

**Before starting work:** Check PLAN.md for current phase and active tasks.

**After completing work:** Update PLAN.md with:
- Checkboxes for completed tasks
- New tasks discovered during implementation
- Status updates for phases
- Change log entry with date and summary

---

## Project Overview

Clutch is a local-first platform for running multiple AI agents as a single organization. It treats agents as employees with roles, permissions, and budgets rather than simple prompts.

**Current Status:** See PLAN.md for implementation progress.

---

## Agent Organization Runtime Spec Alignment

Clutch must conform to the Agent Organization Runtime spec:

### Non-Negotiables

- **Single source of truth**: shared state and event log are authoritative
- **Append-only event log**: all actions emit events; state is derived from events
- **Role-based gates**: Junior code-only, Senior review/merge, HR evaluation, CEO decisions
- **Runtime-agnostic**: agents implement `pull() → run() → push()` contract

### Shared State Layers

- `org_state`: vision, OKRs, policies, budgets, tooling
- `project_state`: architecture summary, ADRs, task graph, release plan
- `agent_state`: local scratch only; must be summarized before promotion

### Required Event Types

`TASK_CREATED`, `TASK_ASSIGNED`, `ARTIFACT_PRODUCED`, `TEST_RUN`, `PR_OPENED`, `REVIEW_COMMENTED`,
`MERGE_APPROVED`, `MERGE_BLOCKED`, `EVAL_REPORTED`, `HIRING_PROPOSAL`, `FIRING_PROPOSAL`,
`DECISION_RECORDED`, `BUDGET_UPDATED`

---

## Clutch Protocol (Source of Truth)

**The Clutch Protocol v0 (`docs/Clutch_Protocol_v0.md`) is the authoritative specification for all inter-agent communication.**

All implementations MUST conform to the protocol. Key aspects:

### Message Envelope (ClutchMessage)

Every message uses a standardized envelope:

```typescript
interface ClutchMessage {
  v: "clutch/0.1";
  id: string;                    // msg_01HX...
  ts: string;                    // ISO timestamp

  // Hierarchy
  thread_id: string;             // UI grouping / conversational context
  run_id: string;                // Top-level execution context
  task_id: string;               // Individual unit of work
  parent_task_id?: string;       // Parent task (enables task trees)

  trace?: { trace_id: string; span_id: string };

  from: { agent_id: string; role?: string };
  to: Array<{ agent_id: string }>;

  // Type system (coarse type + domain + structured payload)
  type: string;                  // task.request, task.result, tool.call, etc.
  domain?: string;               // research, code_review, ops, security
  payload_type?: string;         // research.summary.v1, code.output.v1
  schema_ref?: string;           // schema://clutch/research/summary@1

  payload: unknown;              // Type-specific content

  // Capability routing
  requires?: string[];           // Required capabilities (AND semantics)
  prefers?: string[];            // Preferred capabilities (weighted match)

  security?: {
    auth: { scheme: string; kid: string; sig: string };
    policy: { sandbox: boolean; tool_allowlist: string[] };
  };

  attachments?: Array<{ kind: string; ref: string }>;

  // Delivery
  idempotency_key?: string;      // Client-provided dedup key
  attempt?: number;              // Retry attempt (default: 1)

  meta?: Record<string, unknown>;
}
```

### Message Types

| Category | Types |
|----------|-------|
| **Task Lifecycle** | `task.request`, `task.accept`, `task.progress`, `task.result`, `task.error`, `task.cancel`, `task.timeout` |
| **Conversation** | `chat.message`, `chat.system` |
| **Tooling/MCP** | `tool.call`, `tool.result`, `tool.error` |
| **Agent** | `agent.register`, `agent.heartbeat`, `agent.update` |
| **Routing** | `routing.decision`, `routing.failure` |

### Task Hierarchy

```
run_id              (top-level execution context)
 └─ task_id         (individual unit of work)
     └─ task_id     (subtask, parent_task_id set)
```

- All subtasks share the same `run_id`
- `thread_id` is for UI grouping (may span multiple runs)

### Schema Registry

Payload validation is **workflow-scoped**, not global:

```yaml
workflow: product-research
steps:
  - id: research
    expects:
      payload_type: research.summary.v1
      required: [findings, citations]
```

### Capability Matching

Routing uses `requires[]` (AND) and `prefers[]` (weighted):

1. Hard filters (security, allowlist, limits)
2. Required capabilities (must have all)
3. Preference scoring (tags, tools, domain)
4. Tie-breakers (load, success rate, round-robin)

Every routing decision emits a `routing.decision` event for debugging.

### Agent Registration (AgentCard)

```typescript
interface AgentCard {
  v: "clutch/0.1";
  agent_id: string;              // agent:ken
  display: { name: string; desc: string };
  endpoints: {
    a2a?: { url: string };
    clutch?: { url: string };
  };
  capabilities: Array<{
    id: string;                  // skill:code_review, tool:mcp
    inputs?: string[];
    outputs?: string[];
    servers?: string[];          // For MCP tools
  }>;
  limits: { max_concurrency: number; max_runtime_sec: number };
  security: { sandbox: boolean; network: string };
}
```

### Adapter Interface

Framework-agnostic adapter pattern:

```typescript
interface Adapter {
  name: string;
  canHandle(msg: ClutchMessage): boolean;
  inbound(raw: unknown): Promise<ClutchMessage[]>;
  outbound(msg: ClutchMessage): Promise<unknown>;
}
```

---

## Architecture

```
┌──────────────┐
│   Web UI     │  Slack-like interface (React/TypeScript)
└──────┬───────┘
       │ Event Stream (WebSocket)
┌──────▼───────┐
│   clutchd    │  Control plane daemon
│   ├─ Event Store (append-only)
│   ├─ Agent Registry
│   └─ Adapters (A2A, MCP, Framework)
└──────┬───────┘
       │ ClutchMessage protocol
┌──────▼────────────────┐
│ Agent Pool            │  Docker containers / External endpoints
│ (any framework)       │
└───────────────────────┘
       │
  PostgreSQL + Redis + Artifact Store
```

**Key subsystems:**
- `apps/web/` - Slack-like collaboration UI (event stream consumer)
- `apps/clutchd/` - Control plane daemon (event store, routing, adapters)
- `agents/` - Agent adapters/runtimes
- `config/` - Organization and workflow definitions
- `docs/` - Protocol specifications

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| ClutchMessage | Universal message envelope for all communication |
| AgentCard | Agent capability advertisement |
| Event Stream | Append-only log of all messages and events |
| Thread | Conversational context (thread_id) |
| Run | Execution instance (run_id) |
| Adapter | Framework bridge (A2A, MCP, custom) |

---

## Agent Organization OS (Paradigm)

> **Reference:** `docs/Agent_Organization_Guide.md` for full details.

Clutch treats agents as **employees in an organization**, not just prompts with capabilities.

### Key Principles

1. **Control Plane Mediates Everything**
   - Agents never talk directly to each other
   - All messages flow through the control plane (clutchd)
   - Control plane decides routing based on strengths, not just capabilities

2. **Agents Are Not Always-On**
   - Agents wake for tasks, then sleep
   - Each session is isolated (no state leakage)
   - Heartbeat system: `wake → work → sleep`

3. **Tasks Are Central**
   - All work attaches to a task_id
   - No orphan messages or artifacts
   - Tasks are the unit of accountability and billing

4. **Structured Memory**
   - `WORKING.md` - Current task context (session-scoped)
   - `daily/YYYY-MM-DD.md` - Daily activity log
   - `MEMORY.md` - Long-term knowledge base

5. **AgentSpec Beyond Capabilities**
   - `personality` - How the agent communicates and decides
   - `strengths` - What it excels at (more specific than capabilities)
   - `operating_rules` - Behavioral constraints and guidelines

### Agent Lifecycle

```
┌─────────┐    task.request    ┌─────────┐    task.result    ┌─────────┐
│ ASLEEP  │ ──────────────────►│ WORKING │ ──────────────────►│ ASLEEP  │
└─────────┘                    └─────────┘                    └─────────┘
     │                              │                              ▲
     │      scheduled wakeup        │         timeout/error        │
     └──────────────────────────────┴──────────────────────────────┘
```

### Daily Standup

Automated at configured time:
1. Wake each agent for standup
2. Collect: completed yesterday, planned today, blockers
3. Generate summary as EXEC_REPORT
4. Store in `/memory/daily/`

---

## Design Principles

- **Protocol-first**: All communication via standardized ClutchMessage envelope
- **Framework-agnostic**: Support LangGraph, AutoGen, crewAI, custom agents via adapters
- **Event-sourced**: Everything is an event in an append-only stream
- **Local-first**: Full control over execution, permissions, and data
- **Security by default**: Sandbox, tool allowlists, message authentication

---

## Development Commands

```bash
# Install dependencies
bun install

# Start infrastructure (PostgreSQL, Redis)
make docker-up

# Development mode with hot reload (after docker-up)
make dev
# Or run services individually:
bun run --filter clutchd dev   # Backend on :3001
bun run --filter web dev       # Frontend on :3000

# Build all packages
make build
# Or: bun run build

# Type check
make typecheck
# Or: bun run typecheck

# Lint and format
make lint
make format

# Run tests
make test

# Full local setup (install + docker + migrate + seed)
make setup

# Run E2E demo (requires clutchd running)
make demo
```

---

## Project Structure

```
clutch/
├── apps/
│   ├── web/              # React frontend (Vite + Tailwind)
│   └── clutchd/          # Control plane daemon (Fastify)
├── packages/
│   ├── protocol/         # Clutch Protocol types (ClutchMessage, AgentCard)
│   ├── core/             # Event store, router, registry
│   ├── agents/           # Agent implementations (PM, Research, Marketing, Developer)
│   └── adapters/         # MCP/A2A adapters
├── config/
│   ├── org.yaml          # Agent definitions (personality, strengths, capabilities)
│   └── workflows.yaml    # Workflow definitions
├── docs/
│   ├── Clutch_Protocol_v0.md      # Protocol specification
│   └── Agent_Organization_Guide.md # Organization paradigm
├── workspace/            # Per-agent working directories
├── artifacts/            # Output artifacts with hashes
├── scripts/              # Utility scripts (demo-e2e.ts)
├── docker-compose.yml
├── PLAN.md               # Implementation plan & progress
├── CLAUDE.md             # This file
└── README.md             # Project vision & design
```

---

## Key Files to Know

| File | Purpose |
|------|---------|
| docs/Clutch_Protocol_v0.md | **Protocol specification (highest priority)** |
| docs/Agent_Organization_Guide.md | **Organization paradigm (agent lifecycle, memory model)** |
| README.md | Vision, core concepts, MVP scope |
| PLAN.md | Implementation phases, task tracking, current status |
| config/org.yaml | Agent definitions (personality, strengths, capabilities) |
| config/workflows.yaml | Workflow state machines and review chains |

---

## Implementation Priority

**Current Phase:** Phase 8 - Clutch Runtime Compliance

1. **Event log compliance** - append-only + required event types
2. **Shared state derivation** - org_state + project_state reducers
3. **Role gates** - Junior→Senior review + Senior-only merge
4. **Runtime contract** - pull/run/push for all runtimes
5. **HR/CEO workflows** - scorecards + decisions recorded
