# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Keeping Documentation Synced

**When making changes to this project, you MUST update:**

1. **PLAN.md** - Mark completed tasks, update status, add new tasks if scope changes
2. **CLAUDE.md** - Update architecture, commands, or structure if they change

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
pnpm install

# Start infrastructure (PostgreSQL, Redis)
make docker-up

# Development mode with hot reload (after docker-up)
make dev
# Or run services individually:
pnpm --filter clutchd dev   # Backend on :3001
pnpm --filter web dev       # Frontend on :3000

# Build all packages
make build
# Or: pnpm run build

# Type check
make typecheck
# Or: pnpm run typecheck

# Lint and format
make lint
make format

# Run tests
make test

# Full local setup (install + docker + migrate + seed)
make setup
```

---

## Project Structure

```
clutch/
├── apps/
│   ├── web/              # React frontend (event stream UI)
│   └── clutchd/          # Control plane daemon
├── agents/
│   └── openclaw/         # OpenClaw agent adapter
├── packages/
│   └── protocol/         # Shared protocol types (ClutchMessage, AgentCard)
├── config/
│   ├── org.yaml          # Agent definitions
│   └── workflows.yaml    # Workflow definitions
├── docs/
│   └── Clutch_Protocol_v0.md  # Protocol specification (SOURCE OF TRUTH)
├── workspace/            # Per-agent working directories
├── artifacts/            # Output artifacts with hashes
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
| README.md | Vision, core concepts, MVP scope |
| PLAN.md | Implementation phases, task tracking, current status |
| config/org.yaml | Agent definitions and permissions |
| config/workflows.yaml | Workflow state machines and review chains |

---

## Implementation Priority

1. **Protocol types** (`packages/protocol/`) - ClutchMessage, AgentCard schemas
2. **Event store** - Append-only message storage
3. **Agent registry** - AgentCard-based registration
4. **Adapters** - MCP adapter, A2A adapter
5. **UI streaming** - Event stream to WebSocket

---

## Migration Notes

The current implementation uses legacy message types (`PLAN`, `PROPOSAL`, etc.). These need to be migrated to protocol-compliant types:

| Legacy | Protocol Equivalent |
|--------|-------------------|
| `PLAN` | `task.request` with intent="plan" |
| `PROPOSAL` | `task.progress` or `task.result` |
| `EXEC_REPORT` | `task.result` |
| `REVIEW` | `task.accept` or `task.error` |
| `BLOCKER` | `task.error` or `chat.system` |
