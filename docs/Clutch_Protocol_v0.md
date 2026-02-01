# Clutch Protocol v0

A lightweight, framework-agnostic protocol for building interoperable multi-agent systems.

---

## Goals

- Support multiple agent frameworks simultaneously (LangGraph, AutoGen, crewAI, custom agents)
- Enable consistent delegation, collaboration, and result sharing between agents
- Represent conversations, tasks, tool calls, and failures in a single event stream
- Power a Slack-like UI that observes *everything* via events

## Non-goals

- Standardizing internal reasoning or chain-of-thought
- Forcing a specific agent runtime, memory model, or planner

---

## Comparison with A2A and MCP

Clutch Protocol is **complementary** to A2A and MCP, not a replacement. Each protocol solves a different problem:

| Protocol | Primary Purpose | Scope |
|----------|----------------|-------|
| **MCP** (Model Context Protocol) | Tool calling | Agent ↔ Tool |
| **A2A** (Agent-to-Agent) | Agent discovery & interop | Agent ↔ Agent (federated) |
| **Clutch Protocol** | Multi-agent orchestration | Agent coordination (centralized) |

### vs. A2A (Google Agent-to-Agent)

A2A enables agents from **different organizations** to discover and communicate with each other via `.well-known/agent.json`. It's designed for the open web.

Clutch Protocol is designed for **orchestrating agents within a controlled environment** - running multiple agents as a coordinated team.

| Aspect | A2A | Clutch Protocol |
|--------|-----|-----------------|
| Use case | Open agent federation | Internal multi-agent orchestration |
| Discovery | Decentralized (`.well-known`) | Centralized registry |
| Task hierarchy | Not specified | `run_id` → `task_id` → `parent_task_id` |
| Structured outputs | Not enforced | Schema registry with `payload_type` |
| Routing decisions | Agent-side | Centralized with `routing.decision` events |
| Audit trail | Not built-in | Append-only event store |
| Capability matching | Agent advertises, caller decides | Router matches `requires[]`/`prefers[]` |
| Budget/limits | Not specified | Built into AgentCard, enforced |

**Relationship**: Clutch uses A2A as an **adapter** for external agent communication. Internal agents use Clutch Protocol; external A2A agents are accessed via the A2A adapter.

### vs. MCP (Model Context Protocol)

MCP standardizes how agents call **tools** (file systems, databases, APIs). It's the interface between an agent and its capabilities.

Clutch Protocol standardizes how **agents communicate with each other** and how an orchestrator manages them.

| Aspect | MCP | Clutch Protocol |
|--------|-----|-----------------|
| Use case | Tool invocation | Agent-to-agent messaging |
| Scope | Single agent's tools | Multi-agent coordination |
| Message types | `tools/call`, `tools/list` | `task.*`, `chat.*`, `tool.*`, `agent.*`, `routing.*` |
| State management | Stateless RPC | Event-sourced (append-only) |
| Observability | Per-call | Full event stream |

**Relationship**: Clutch wraps MCP tool calls in `tool.call`/`tool.result` messages. The MCP adapter translates between Clutch Protocol and MCP servers.

### When to Use What

| Scenario | Protocol |
|----------|----------|
| Agent needs to call a tool (database, API, filesystem) | **MCP** |
| Agent needs to talk to an external agent from another org | **A2A** |
| Orchestrating multiple agents as a team internally | **Clutch Protocol** |
| All of the above | Clutch Protocol + MCP adapter + A2A adapter |

### What Clutch Protocol Adds

The core value is the **operational layer** for multi-agent systems:

1. **Unified Event Stream** - Every message, tool call, routing decision, and state change is an observable event
2. **Structured Contracts** - `domain` + `payload_type` + schema registry prevents unstructured "prompt soup"
3. **Task DAGs** - Hierarchical task tracking (`run_id` → `task_id` → subtasks) with partial retry
4. **Centralized Routing** - Router decides agent assignment with observable `routing.decision` events
5. **Framework Agnostic** - Adapters normalize LangGraph, AutoGen, crewAI, MCP, A2A into one protocol
6. **Audit & Replay** - Append-only event store enables debugging and reproducibility

---

## 1. Core Concepts

### 1.1 Envelope (ClutchMessage)

All communication is wrapped in a **ClutchMessage envelope**.
Inbound messages from any protocol (A2A, framework-specific, HTTP) are normalized into this format.

```json
{
  "v": "clutch/0.1",
  "id": "msg_01HX...",
  "ts": "2026-02-01T13:20:11.123Z",

  "thread_id": "thr_01HX...",
  "run_id": "run_01HX...",
  "task_id": "task_01HX...",
  "parent_task_id": null,

  "trace": { "trace_id": "tr_...", "span_id": "sp_..." },

  "from": { "agent_id": "agent:ken", "role": "worker" },
  "to": [{ "agent_id": "agent:orchestrator" }],

  "type": "task.result",
  "domain": "research",
  "payload_type": "research.summary.v1",
  "schema_ref": "schema://clutch/research/summary@1",

  "payload": {
    "title": "Market analysis complete",
    "findings": ["..."],
    "citations": ["https://..."]
  },

  "requires": ["skill:research"],
  "prefers": ["tool:browser", "domain:fintech"],

  "security": {
    "auth": { "scheme": "ed25519", "kid": "key_01", "sig": "..." },
    "policy": { "sandbox": true, "tool_allowlist": ["mcp:browser", "mcp:files"] }
  },

  "attachments": [
    { "kind": "artifact_ref", "ref": "artifact:report_456" }
  ],

  "idempotency_key": "idem_01HX...",
  "attempt": 1,

  "meta": {
    "framework": "langgraph",
    "ui_channel": "chat:research"
  }
}
```

### 1.2 Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `v` | Yes | Protocol version (`clutch/0.1`) |
| `id` | Yes | Unique message ID (for deduplication) |
| `ts` | Yes | ISO 8601 timestamp |
| `thread_id` | Yes | Conversational context (UI grouping) |
| `run_id` | Yes | Top-level execution context |
| `task_id` | Yes | Individual unit of work |
| `parent_task_id` | No | Parent task (enables task trees) |
| `trace` | No | Distributed tracing IDs |
| `from` | Yes | Sender identity |
| `to` | Yes | Recipient(s) |
| `type` | Yes | Message type (lifecycle event) |
| `domain` | No | Problem space (`research`, `code_review`, `ops`) |
| `payload_type` | No | Structured contract ID (`research.summary.v1`) |
| `schema_ref` | No | Canonical schema reference |
| `payload` | Yes | Type-specific content |
| `requires` | No | Required capabilities (AND semantics) |
| `prefers` | No | Preferred capabilities (weighted match) |
| `security` | No | Auth and policy |
| `attachments` | No | Artifact references |
| `idempotency_key` | No | Client-provided dedup key |
| `attempt` | No | Retry attempt number (default: 1) |
| `meta` | No | Framework-specific metadata |

---

### 1.3 Task Hierarchy

```
run_id          (top-level execution context)
 └─ task_id     (individual unit of work)
     └─ task_id (subtask, with parent_task_id set)
         └─ ...
```

**Rules:**
- All subtasks of an orchestration share the same `run_id`
- Each delegation creates a new `task_id`
- Parent-child relationships are explicit via `parent_task_id`
- `thread_id` is for UI grouping (may span multiple runs)

This enables:
- DAG / tree visualization
- Partial retries
- Accurate provenance tracking

---

### 1.4 Agent Registration (AgentCard)

Agents advertise capabilities via an **AgentCard**.

```json
{
  "v": "clutch/0.1",
  "agent_id": "agent:ken",
  "display": { "name": "Ken", "desc": "Research specialist" },

  "endpoints": {
    "a2a": { "url": "http://ken:8080/a2a" },
    "clutch": { "url": "http://ken:8080/clutch" }
  },

  "capabilities": [
    {
      "id": "skill:research",
      "version": "1.0",
      "tags": ["market", "competitive", "fintech"],
      "tools": ["mcp:browser", "mcp:files"],
      "trust_level": "sandbox",
      "cost_hint": "medium"
    },
    {
      "id": "tool:mcp",
      "servers": ["mcp:browser", "mcp:files"]
    }
  ],

  "limits": {
    "max_concurrency": 2,
    "max_runtime_sec": 600
  },

  "security": {
    "sandbox": true,
    "network": "egress-restricted"
  }
}
```

### 1.5 Capability Model

Each capability includes:

| Field | Description |
|-------|-------------|
| `id` | Capability identifier (`skill:research`, `tool:mcp`) |
| `version` | Semantic version or range |
| `tags` | Domain tags for matching |
| `tools` | Required MCP servers |
| `trust_level` | `sandbox` or `prod` |
| `cost_hint` | `low`, `medium`, `high` |

---

### 1.6 Event Stream

Everything is an event:
- Chat messages
- Task delegation and completion
- Tool calls and failures
- Agent lifecycle events
- **Routing decisions**

The UI and audit layer consume the same append-only stream.

---

## 2. Message Types

### 2.1 Task Lifecycle

| Type | Description |
|------|-------------|
| `task.request` | Request to perform work |
| `task.accept` | Agent accepts the task |
| `task.progress` | Intermediate status update |
| `task.result` | Task completed successfully |
| `task.error` | Task failed |
| `task.cancel` | Task cancelled |
| `task.timeout` | Task timed out |

### 2.2 Conversation

| Type | Description |
|------|-------------|
| `chat.message` | Agent or human message |
| `chat.system` | System notification |

### 2.3 Tooling / MCP

| Type | Description |
|------|-------------|
| `tool.call` | Invoke a tool |
| `tool.result` | Tool succeeded |
| `tool.error` | Tool failed |

### 2.4 Agent Lifecycle

| Type | Description |
|------|-------------|
| `agent.register` | Agent comes online |
| `agent.heartbeat` | Agent health check |
| `agent.update` | Capability change |

### 2.5 Routing (Internal)

| Type | Description |
|------|-------------|
| `routing.decision` | Explains why an agent was selected |
| `routing.failure` | No agent matched requirements |

---

## 3. Schema Registry

### 3.1 Purpose

Schemas define the structure of `payload` for each `payload_type`.
Validation is **workflow-scoped**, not global.

### 3.2 Schema Identification

```
payload_type: "research.summary.v1"
schema_ref:   "schema://clutch/research/summary@1"
```

### 3.3 Built-in Payload Types

| Domain | Payload Type | Required Fields |
|--------|--------------|-----------------|
| research | `research.summary.v1` | `findings[]`, `citations[]` |
| research | `research.sources.v1` | `sources[]`, `relevance_scores` |
| code | `code.output.v1` | `files[]`, `language`, `tests_passed` |
| code | `code.review.v1` | `findings[]`, `severity`, `patch_ref?` |
| review | `review.feedback.v1` | `decision`, `comments`, `blocking_issues[]` |

### 3.4 Workflow Validation

Validation rules are defined per workflow:

```yaml
workflow: product-research
steps:
  - id: research
    expects:
      type: task.result
      payload_type: research.summary.v1
      required:
        - findings
        - citations
```

This recovers structured output guarantees without hardcoding into the protocol.

---

## 4. Capability Matching

### 4.1 Resolver

Capability resolution is performed by the **Orchestrator / Router**.

### 4.2 Matching Algorithm

1. **Hard filters** (must pass)
   - Security policy compliance
   - Tool allowlist
   - Concurrency limit not exceeded
   - Network access requirements

2. **Required capabilities** (`requires[]`)
   - AND semantics: agent must have all
   - Match by capability `id`

3. **Preference scoring** (`prefers[]`)
   - Weighted match on tags, tools, domain
   - Higher score = better fit

4. **Tie-breakers**
   - Least loaded
   - Recent success rate
   - Round-robin

### 4.3 Routing Decision Event

Every routing decision emits an event:

```json
{
  "type": "routing.decision",
  "task_id": "task_01HX...",
  "payload": {
    "selected": "agent:ken",
    "candidates": ["agent:ken", "agent:research-2"],
    "reason": "matched requires[skill:research], lowest load",
    "scores": {
      "agent:ken": 0.92,
      "agent:research-2": 0.85
    }
  }
}
```

This is essential for debugging multi-agent workflows.

---

## 5. Delivery Semantics

### 5.1 Guarantees

- **At-least-once delivery**
- **Deduplication** by the receiver

### 5.2 Deduplication

| Method | Scope | Description |
|--------|-------|-------------|
| `msg.id` | Primary | Unique per message |
| `idempotency_key` | Optional | Client-provided for commands |
| Dedup window | `(run_id, msg.id)` | Scoped to execution context |

**Retention:** Dedup state retained until run completion (backed by event store).

### 5.3 Retries

| Field | Description |
|-------|-------------|
| `attempt` | Current attempt number (1-based) |
| `retryable` | In error responses: `true` or `false` |

**Ordering:** Best-effort per `task_id`. No global ordering guarantee.

### 5.4 Error Responses

```json
{
  "type": "task.error",
  "payload": {
    "code": "TOOL_UNAVAILABLE",
    "message": "MCP server mcp:browser not responding",
    "retryable": true,
    "details": { "tool": "mcp:browser", "timeout_ms": 5000 }
  }
}
```

---

## 6. Security Defaults

- **Sandbox by default**: Agents run isolated unless explicitly trusted
- **Tool allowlists**: Per-agent and per-message policy
- **Restricted network egress**: Allowlist-based outbound access
- **Message authentication**: ed25519 signatures on sensitive operations
- **Structural prompt-injection defenses**: Payload boundaries enforced

---

## 7. Adapter Strategy

### 7.1 Architecture

```
External Protocol     Clutch Core
      │                   │
      ▼                   ▼
  ┌─────────┐       ┌──────────┐
  │ Adapter │ ◄───► │  Router  │
  └─────────┘       └──────────┘
       │                  │
       ▼                  ▼
   Framework          Event Store
```

### 7.2 Adapter Interface

```typescript
interface Adapter {
  name: string;
  canHandle(msg: ClutchMessage): boolean;
  inbound(raw: unknown): Promise<ClutchMessage[]>;
  outbound(msg: ClutchMessage): Promise<unknown>;
}
```

### 7.3 Built-in Adapters

| Adapter | Purpose |
|---------|---------|
| `mcp` | Tool calling via MCP servers |
| `a2a` | Google A2A protocol interop |
| `langgraph` | LangGraph event translation |
| `autogen` | AutoGen message translation |
| `http` | Generic HTTP webhook |

---

## 8. Storage

### 8.1 Event Store

- **Append-only**: Immutable event log
- **Primary key**: `msg.id`
- **Indexes**: `run_id`, `thread_id`, `task_id`, `from.agent_id`
- **Replay**: By `run_id` for debugging and recovery

### 8.2 Artifact Store

- Large payloads stored separately
- Referenced via `artifact:<id>` in attachments
- Content-addressed (hash-based)

---

## 9. Reference Directory Structure

```
clutch/
  apps/
    gateway/              # HTTP / WS ingress
    orchestrator/         # Task routing and planning
  packages/
    protocol/             # ClutchMessage, AgentCard types
    core/
      router.ts           # Routing, retries, dedupe
      store.ts            # Event store interface
      registry.ts         # Agent registry
      schemas/            # Schema registry
    adapters/
      mcp/
      a2a/
      langgraph/
      autogen/
  deployments/
    docker-compose.yml
  docs/
    Clutch_Protocol_v0.md
```

---

## 10. End-to-End Example

**Scenario:** User requests market research via UI.

```
1. UI → Gateway
   type: task.request
   domain: research
   payload_type: research.query.v1
   to: [agent:orchestrator]

2. Orchestrator evaluates capabilities
   type: routing.decision
   selected: agent:ken
   reason: "matched skill:research, lowest load"

3. Orchestrator → Ken
   type: task.request
   task_id: task_abc
   run_id: run_xyz

4. Ken → Orchestrator
   type: task.accept

5. Ken → MCP
   type: tool.call
   payload: { tool: "mcp:browser", args: {...} }

6. MCP → Ken
   type: tool.result

7. Ken → Orchestrator
   type: task.result
   domain: research
   payload_type: research.summary.v1
   payload: { findings: [...], citations: [...] }

8. UI subscribes to thread_id, renders all events
```

---

## 11. Implementation Order

1. `packages/protocol/` - ClutchMessage + AgentCard schemas (Zod)
2. Event store (append-only, PostgreSQL)
3. Agent registry + heartbeat
4. Schema registry (workflow-scoped validation)
5. Router with capability matching
6. UI streaming (WebSocket)
7. MCP adapter
8. A2A adapter
9. Framework adapters

---

## Appendix A: Migration from Legacy Types

| Legacy Type | Protocol Equivalent |
|-------------|---------------------|
| `PLAN` | `task.request` with `domain: planning` |
| `PROPOSAL` | `task.progress` or `task.result` |
| `EXEC_REPORT` | `task.result` with appropriate `payload_type` |
| `REVIEW` | `task.result` with `payload_type: review.feedback.v1` |
| `BLOCKER` | `task.error` or `chat.system` |

---

## Appendix B: Reserved Prefixes

| Prefix | Usage |
|--------|-------|
| `agent:` | Agent identifiers |
| `group:` | Agent group identifiers |
| `task:` | Task identifiers |
| `run:` | Run identifiers |
| `thread:` | Thread identifiers |
| `artifact:` | Artifact references |
| `schema://` | Schema references |
| `mcp:` | MCP server identifiers |
| `skill:` | Skill capability identifiers |
| `tool:` | Tool capability identifiers |
