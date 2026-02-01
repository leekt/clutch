# Clutch
**A colony of OpenClaw agents**

Clutch is a **local-first, installable platform** that lets you run multiple AI agents as a single organization.

Instead of a single chatbot, Clutch lets you *hire agents*, assign them roles, and have them collaborate, review each other’s work, and deliver outcomes — like a real company.

---

## 1. Problem

Today’s AI agent tools have fundamental limitations:

- Single-agent centric  
- Unstructured natural language conversations  
- Weak permission, security, and cost controls  
- No durable record of *who did what, why, and with what result*  
- Hard to trust outputs in production workflows  

In short: **agents can talk, but they can’t operate as a team**.

---

## 2. What is Clutch?

Clutch is an **organization operating system for AI agents**.

It treats agents as employees, tasks as tickets, and collaboration as a first-class system primitive.

- Agents are *hired*  
- Work is *assigned*  
- Outputs are *reviewed*  
- Decisions are *logged*  
- Everything is *reproducible*  

Clutch is designed to run **locally or on-prem**, with full control over execution, permissions, and data.

---

## 3. Core Concepts

| Concept | Meaning |
|------|--------|
| Agent | An AI worker with a role, tools, budget, and identity |
| Organization | A group of agents with shared policies |
| Task | A unit of work (ticket) |
| Channel | A Slack-like workspace for a task or department |
| Protocol | A strict message/output contract |
| Review | A required quality gate between agents |

---

## 4. Agent Hiring Model

Agents are not prompts — they are **configured workers**.

When you hire an agent, you define:

- Name and role (Research, Marketing, Dev, QA, PM)
- Runtime (Docker image, endpoint)
- Tool permissions (file, shell, git, browser)
- Secret scopes (API keys per agent)
- Budget limits (tokens, time, API cost)
- Output contracts (required formats and checks)

> Clutch hires *roles*, not models.

---

## 5. Slack-like Collaboration UI

Clutch presents agent collaboration in a familiar interface:

- **Channels**
  - `#task-123-landing-page`
  - `#research`, `#dev`, `#ops`

- **Threads**
  - `thread_id` for conversational context
  - `run_id` for execution instances

- **Event Stream**
  - All messages, tool calls, and lifecycle events in one unified stream
  - Real-time updates via WebSocket

This makes agent work **auditable, reviewable, and reproducible**.

---

## 6. Clutch Protocol

> See `docs/Clutch_Protocol_v0.md` for the full specification.

Clutch uses a **standardized message protocol** for all inter-agent communication.

### ClutchMessage Envelope

Every message is wrapped in a universal envelope:

```json
{
  "v": "clutch/0.1",
  "id": "msg_01HX...",
  "ts": "2026-02-01T13:20:11.123Z",
  "thread_id": "thr_01HX...",
  "run_id": "run_01HX...",
  "trace": { "trace_id": "...", "span_id": "..." },
  "from": { "agent_id": "agent:research" },
  "to": [{ "agent_id": "agent:orchestrator" }],
  "type": "task.result",
  "payload": { ... },
  "attachments": [{ "kind": "artifact_ref", "ref": "artifact:report_123" }]
}
```

### Message Types

| Category | Types |
|----------|-------|
| Task Lifecycle | `task.request`, `task.accept`, `task.progress`, `task.result`, `task.error`, `task.cancel`, `task.timeout` |
| Conversation | `chat.message`, `chat.system` |
| Tooling | `tool.call`, `tool.result`, `tool.error` |
| Agent | `agent.register`, `agent.heartbeat`, `agent.update` |

### Framework Adapters

Clutch supports multiple agent frameworks via adapters:

- **A2A Adapter** - Google A2A protocol for external agent communication
- **MCP Adapter** - Tool calling via MCP servers
- **Framework Adapters** - LangGraph, AutoGen, crewAI, etc.

### Why Not Just A2A or MCP?

Clutch Protocol is **complementary** to A2A and MCP:

| Protocol | Purpose |
|----------|---------|
| **MCP** | Agent ↔ Tool (tool calling) |
| **A2A** | Agent ↔ Agent (federated discovery) |
| **Clutch** | Multi-agent orchestration (internal coordination) |

**What Clutch adds:**
- **Unified Event Stream** - Every message, tool call, and routing decision is observable
- **Task Hierarchy** - `run_id` → `task_id` → subtasks with partial retry
- **Schema Registry** - Structured payloads prevent unstructured "prompt soup"
- **Centralized Routing** - Router assigns agents with observable `routing.decision` events
- **Audit & Replay** - Append-only event store for debugging and reproducibility

> See `docs/Clutch_Protocol_v0.md` for the full comparison and specification.

```typescript
interface Adapter {
  name: string;
  canHandle(msg: ClutchMessage): boolean;
  inbound(raw: unknown): Promise<ClutchMessage[]>;
  outbound(msg: ClutchMessage): Promise<unknown>;
}
```

This enables **framework-agnostic multi-agent collaboration**

---

## 7. Control Plane (clutchd)

Clutch is orchestrated by a central control plane daemon.

Responsibilities:

- Task creation and decomposition
- Agent assignment and routing
- Workflow enforcement
- Review chaining
- Budget enforcement
- Audit logging

State machine example:

```
created → assigned → running → review → rework → done
```

---

## 8. Architecture Overview

```
┌──────────────┐
│   Web UI     │  Slack-like interface
└──────┬───────┘
       │ events (WS / SSE)
┌──────▼───────┐
│   clutchd    │  Control Plane
└──────┬───────┘
       │ dispatch / callbacks
┌──────▼────────────────┐
│ OpenClaw Agent Pool    │  Docker containers
│ - research             │
│ - marketing            │
│ - dev                  │
│ - qa                   │
└────────────────────────┘
```

Shared services:
- PostgreSQL (tasks, messages, reviews)
- Redis (queues)
- Local volumes (workspace, artifacts)

---

## 9. Project Structure (Proposed)

```
clutch/
├─ apps/
│  ├─ web/            # Slack-like UI
│  └─ clutchd/        # Control plane daemon
│
├─ agents/
│  └─ openclaw/       # OpenClaw adapter/runtime
│
├─ config/
│  ├─ org.yaml        # Organization & agent definitions
│  └─ workflows.yaml
│
├─ workspace/         # Per-agent workspaces
├─ artifacts/         # Outputs with hashes
│
├─ docker-compose.yml
└─ README.md
```

---

## 10. MVP Scope

### Initial Agents
- PM (Orchestrator)
- Research
- Marketing
- Developer

### End-to-end Scenario
> Product idea → research → landing copy → code implementation → QA review

Success criteria:
- Fully automated task flow
- Review and rejection loops
- All outputs logged and reproducible
- Visible collaboration timeline in UI

---

## 11. Why Clutch is Different

Clutch is **not** another chat-based agent tool.

It focuses on:
- Capability-based permissions
- Audit logs and replayability
- Output contracts and review chains
- Organization-level reasoning

Clutch is infrastructure for **trustworthy AI operations**.

---

## 12. Roadmap Ideas

- Agent template marketplace
- Human-in-the-loop reviews
- Policy engine (rule-based approvals)
- Org snapshots and replay
- Multi-org and multi-project support

---

## 13. Vision

AI agents will not replace individuals.  
They will replace **teams that cannot coordinate**.

Clutch exists to make AI coordination reliable, auditable, and real.
