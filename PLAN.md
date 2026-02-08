# PLAN.md

Implementation plan for Clutch - tracking progress toward MVP goals.

**Last Updated:** 2026-02-08

---

## MVP Success Criteria (from README.md)

- [x] Fully automated task flow
- [x] Review and rejection loops
- [x] All outputs logged and reproducible
- [x] Visible collaboration timeline in UI

**End-to-end Scenario:** Product idea → research → landing copy → code implementation → QA review ✅

---

## Docs Drift (Needs Sync)

- Codex OAuth uses a fixed client id + PKCE and a local callback at `http://localhost:1455/auth/callback` (no env client id required).
- Claude/Codex subprocess workers are JS PTY wrappers (`scripts/claude-code-worker.js`, `scripts/codex-code-worker.js`) invoked via runtime normalization (no `bun run`).
- Local settings + secrets now persist under `~/.clutch/<workspace_name>/` (settings + secrets).

---

## Next Steps (Ordered)

1. Update docs for Codex OAuth flow, local callback, and local secrets directory.
2. Update docs for Claude Code login/setup and tool permission mapping.
3. Add a small CLI/script to sanity-check subprocess workers without the UI.

---

## Phase 0: Project Setup & Infrastructure

**Status:** ✅ Complete

**Goal:** Establish monorepo structure, build tooling, and local development environment.

### Tasks

- [x] Initialize monorepo with bun workspaces
- [x] Set up TypeScript configuration (shared tsconfig)
- [x] Create `apps/web/` - Vite React app with Tailwind CSS
- [x] Create `apps/clutchd/` - Node.js/TypeScript service with Fastify
- [x] Create `agents/openclaw/` - Agent runtime adapter with Dockerode
- [x] Set up `docker-compose.yml` with PostgreSQL, Redis
- [x] Create `config/` directory with schema for `org.yaml` and `workflows.yaml`
- [x] Set up ESLint, Prettier, and shared configs
- [x] Create Makefile with common commands (dev, build, test, lint)
- [x] Add `.env.example` for environment variables

### Deliverables

- [x] Working `docker-compose up` that starts all services
- [x] `make dev` runs web UI and clutchd in watch mode
- [x] Directory structure matches proposed layout in README

---

## Phase 1: Data Layer & Schemas

**Status:** ✅ Complete

**Goal:** Define and implement database schemas and data access layer.

### Tasks

- [x] Design PostgreSQL schema:
  - `agents` - agent definitions (name, role, config, permissions)
  - `tasks` - task records (state, assignee, parent, created_at)
  - `channels` - channel definitions (type, task_id, name)
  - `messages` - structured messages (type, sender, channel, payload, artifacts)
  - `reviews` - review records (task_id, reviewer, status, comments)
  - `audit_logs` - all actions with timestamps and cost metadata
- [x] Set up database migrations (using Drizzle)
- [x] Implement Redis queue schemas for task dispatch
- [x] Create TypeScript types matching all schemas
- [x] Implement repository layer with CRUD operations
- [x] Add seed data for development (sample agents, org config)

### Deliverables

- [x] Database migrations that can be run with single command (`bun run --filter clutchd db:migrate`)
- [x] Type-safe data access layer (repositories for all entities)
- [x] Seed script for local development (`bun run --filter clutchd db:seed`)

### Files Created

- `apps/clutchd/src/db/schema.ts` - Drizzle schema with all tables and relations
- `apps/clutchd/src/db/index.ts` - Database connection and exports
- `apps/clutchd/src/db/migrate.ts` - Migration runner
- `apps/clutchd/src/db/seed.ts` - Development seed data
- `apps/clutchd/src/repositories/*.ts` - CRUD repositories for each entity
- `apps/clutchd/src/queue/index.ts` - Redis queue implementation
- `apps/clutchd/drizzle/0000_*.sql` - Generated migration

---

## Phase 2: Control Plane (clutchd)

**Status:** ✅ Complete

**Goal:** Implement the core orchestration engine.

### Tasks

#### 2.1 Core Framework
- [x] Set up HTTP server (Fastify)
- [x] Set up WebSocket for real-time events
- [x] Implement health check endpoint
- [x] Add structured logging with correlation IDs

#### 2.2 Agent Registry
- [x] Load agent definitions from database/config
- [x] Agent status tracking (available, busy, offline)
- [x] Agent capability matching for task assignment

#### 2.3 Task State Machine
- [x] Implement states: `created → assigned → running → review → rework → done`
- [x] State transition validation
- [x] Event emission on state changes
- [x] Timeout and failure handling

#### 2.4 Message Protocol
- [x] Define message types: PLAN, PROPOSAL, EXEC_REPORT, REVIEW, BLOCKER
- [x] Message validation (required fields: summary, body, artifacts, citations, cost)
- [x] Artifact hash verification
- [x] Message persistence and retrieval

#### 2.5 Workflow Engine
- [x] Parse `workflows.yaml` definitions
- [x] Workflow step execution
- [x] Review chain enforcement
- [x] Conditional branching (approval/rejection paths)

#### 2.6 Budget & Permissions
- [x] Token/cost tracking per agent
- [x] Budget limit enforcement
- [x] Tool permission checking
- [x] Secret scope management

### Deliverables

- [x] Running clutchd service with REST + WebSocket APIs
- [x] Task lifecycle fully managed
- [x] Messages stored and retrievable
- [x] Budget tracked per agent

### Files Created

- `apps/clutchd/src/middleware/correlation.ts` - Correlation ID middleware
- `apps/clutchd/src/middleware/index.ts` - Middleware exports
- `apps/clutchd/src/routes/agents.ts` - Agent API routes
- `apps/clutchd/src/routes/tasks.ts` - Task API routes
- `apps/clutchd/src/routes/channels.ts` - Channel API routes
- `apps/clutchd/src/routes/messages.ts` - Message API routes
- `apps/clutchd/src/routes/reviews.ts` - Review API routes
- `apps/clutchd/src/routes/index.ts` - Route registration
- `apps/clutchd/src/services/task-state-machine.ts` - Task state machine
- `apps/clutchd/src/services/message-validator.ts` - Message validation
- `apps/clutchd/src/services/agent-registry.ts` - Agent registry service
- `apps/clutchd/src/services/workflow-engine.ts` - Workflow engine
- `apps/clutchd/src/services/budget-service.ts` - Budget tracking service
- `apps/clutchd/src/services/index.ts` - Service exports

---

## Phase 3: Agent Runtime

**Status:** Partial (Docker runtime removed; agents run in-process. Runtime abstraction added for HTTP/subprocess support)

**Goal:** Implement agent execution environment with pluggable isolation.

### Tasks

#### 3.1 Runtime Abstraction (NEW)
- [x] Define `AgentRuntime` interface with `execute()`, `getHealth()`, `shutdown()`
- [x] `RuntimeConfig` discriminated union: `in-process`, `http`, `subprocess`
- [x] `InProcessRuntime` — wraps existing `BaseAgent` subclasses (zero behavior change)
- [x] `HttpRuntime` — delegates to external HTTP agent endpoints
- [x] `SubprocessRuntime` — spawns child process per task (stdio or http protocol)
- [x] `createRuntime()` factory function
- [x] Refactored `AgentExecutorService` to use runtime registry instead of hardcoded agents
- [x] Added `runtime` column to agents DB schema
- [x] Updated `org.yaml` and seed data with runtime config

#### 3.2 OpenClaw Adapter (removed)
- [x] ~~Implement adapter interface~~ (removed in build simplification)

#### 3.3 Docker Runtime (removed)
- [ ] Agent container image definitions — removed, replaced by runtime abstraction
- [ ] Container lifecycle management — deferred

#### 3.4 Tool Permissions
- [x] File system access control per agent
- [x] Shell command allowlist/denylist
- [x] Git operations control
- [x] Browser/HTTP access control
- [x] Permission checker with trust levels (sandbox/prod)

#### 3.5 Agent Communication
- [x] Dispatch tasks to agents (via runtime abstraction)
- [x] Receive results from agents
- [x] Progress streaming
- [x] Handle agent failures and retries

#### 3.6 Agent Worker Service
- [x] Task queue consumer in clutchd
- [x] Result processor with workflow integration
- [x] Budget recording and enforcement

### Deliverables

- [x] Agents execute via pluggable runtime abstraction
- [x] In-process, HTTP, and subprocess runtimes available
- [x] Tool permissions enforced at runtime
- [x] Agent output captured and stored

### Files Created

- `packages/agents/src/runtime/types.ts` - AgentRuntime interface, RuntimeConfig union
- `packages/agents/src/runtime/in-process.ts` - InProcessRuntime wrapping BaseAgent
- `packages/agents/src/runtime/http.ts` - HttpRuntime for external agents
- `packages/agents/src/runtime/subprocess.ts` - SubprocessRuntime for child processes
- `packages/agents/src/runtime/factory.ts` - createRuntime() factory
- `packages/agents/src/runtime/index.ts` - Re-exports
- `apps/clutchd/src/services/agent-worker.ts` - Task queue worker service
- `apps/clutchd/src/routes/agent-callbacks.ts` - Agent callback API routes
- `apps/clutchd/drizzle/0001_add_agent_runtime.sql` - Migration for runtime column

---

## Phase 4: Web UI

**Status:** ✅ Complete

**Goal:** Build Slack-like collaboration interface.

### Tasks

#### 4.1 Core Layout
- [x] Sidebar with channel list
- [x] Main content area with message feed
- [x] Tab-based navigation (Channels, Tasks, Agents)
- [x] Header with org/status info
- [x] WebSocket connection status indicator

#### 4.2 Channel Views
- [x] Task channels with message display
- [x] Department channels (general, research, dev, marketing)
- [x] Channel message feed with Clutch Protocol types
- [x] Unread indicators per channel

#### 4.3 Message Components
- [x] Message card component with Clutch Protocol types
- [x] Support for all message types (task.*, chat.*, tool.*, agent.*, routing.*)
- [x] Artifact display with download links
- [x] Cost/runtime metadata display
- [x] Agent status indicators in messages

#### 4.4 Real-time Updates
- [x] WebSocket hook with reconnection logic
- [x] Live task status updates
- [x] Agent activity indicators
- [x] State synchronization via Zustand store

#### 4.5 Task Management
- [x] Task creation form/modal
- [x] Task list view with state filtering
- [x] Task detail panel with full history
- [x] Task state visualization
- [x] Review interface (approve/reject with comments)
- [x] Pending review indicators

#### 4.6 Agent Dashboard
- [x] Agent list with status
- [x] Agent detail panel (permissions, budget, capabilities)
- [x] Status filtering (all, available, busy, offline)

### Deliverables

- [x] Functional Slack-like UI
- [x] Real-time collaboration view
- [x] Task and agent management interfaces

### Files Created

- `apps/web/src/types/index.ts` - TypeScript types for Clutch Protocol
- `apps/web/src/lib/api.ts` - API client for clutchd
- `apps/web/src/hooks/useWebSocket.ts` - WebSocket hook with reconnection
- `apps/web/src/hooks/useQueries.ts` - React Query hooks for data fetching
- `apps/web/src/store/index.ts` - Zustand store for state management
- `apps/web/src/components/Layout.tsx` - Main layout with data loading
- `apps/web/src/components/Sidebar.tsx` - Navigation sidebar with tabs
- `apps/web/src/components/ChannelView.tsx` - Channel message view
- `apps/web/src/components/MessageCard.tsx` - Protocol-aware message display
- `apps/web/src/components/MessageInput.tsx` - Task creation input
- `apps/web/src/components/TasksView.tsx` - Task list and management
- `apps/web/src/components/TaskDetailPanel.tsx` - Task details with reviews
- `apps/web/src/components/AgentsView.tsx` - Agent list and details

---

## Phase 5: MVP Agents

**Status:** ✅ Complete

**Goal:** Implement the four initial agents for end-to-end scenario.

### Tasks

#### 5.1 PM (Orchestrator) Agent
- [x] Task decomposition logic
- [x] Agent assignment decisions
- [x] Progress monitoring
- [x] Escalation handling

#### 5.2 Research Agent
- [x] Web search capabilities
- [x] Information synthesis
- [x] Structured research output (PROPOSAL format)
- [x] Citation collection

#### 5.3 Marketing Agent
- [x] Copy generation
- [x] Landing page content creation
- [x] Brand voice consistency
- [x] A/B variant generation

#### 5.4 Developer Agent
- [x] Code generation
- [x] File creation and modification
- [x] Git operations
- [x] Code review response handling

### Deliverables

- [x] Four working agents with defined capabilities
- [x] Each agent produces protocol-compliant outputs
- [x] Agents can participate in review chains

### Files Created

- `packages/agents/` - New package for agent implementations
- `packages/agents/src/types.ts` - Task dispatch/result types
- `packages/agents/src/executor/base-agent.ts` - Base agent class with execution framework
- `packages/agents/src/executor/llm-client.ts` - LLM abstraction (OpenAI/Anthropic)
- `packages/agents/src/agents/pm.ts` - PM agent (task decomposition, agent assignment)
- `packages/agents/src/agents/research.ts` - Research agent (web search, fact-checking, synthesis)
- `packages/agents/src/agents/marketing.ts` - Marketing agent (copy, landing pages, A/B variants)
- `packages/agents/src/agents/developer.ts` - Developer agent (code gen, file ops, git)

---

## Phase 6: Integration & E2E Flow

**Status:** ✅ Complete

**Goal:** Wire everything together for complete MVP workflow.

### Tasks

- [x] End-to-end workflow test: idea → research → marketing → dev → review
- [x] Review chain: PM reviews research, marketing reviews copy, dev reviews code
- [x] Rejection and rework loops working
- [x] All actions logged in audit trail
- [x] Artifacts stored with hashes
- [x] Timeline visible in UI
- [x] Budget tracking across full workflow
- [x] Demo scenario documented and reproducible

### Deliverables

- [x] Complete working MVP
- [x] Demo script for end-to-end scenario (`scripts/demo-e2e.ts`)
- [x] All success criteria met

### Files Created/Updated

- `config/workflows.yaml` - Updated to use Clutch Protocol message types, added marketing-campaign workflow
- `scripts/demo-e2e.ts` - E2E demo script with workflow monitoring
- `apps/clutchd/src/services/agent-executor.ts` - Bridges control plane with agent implementations
- `apps/clutchd/src/services/agent-worker.ts` - Integrated with real agent execution

---

## Current Focus

**Active Phase:** Phase 8 (Clutch Runtime Compliance) + Runtime Abstraction

**Completed Phases:** 0, 1, 2, 2.5, 3 (partial), 4, 5, 6 (Integration), 6 (Org OS), 7 (Colony UI MVP)

**Recent:** Added pluggable Agent Runtime Abstraction (in-process/HTTP/subprocess) and RimWorld Colony UI

**Next Action:** Audit protocol/storage drift (security fields, schema_ref, dedupe); enforce append-only event log; add role-based merge gates

**Next Steps (Security & Hiring):**
1. ✅ Build secrets vault (encrypted) and store OAuth/API tokens as references
2. ✅ Update Hire Agent UI to save tokens into secrets and use refs in runtime config
3. ✅ Resolve secret refs at runtime (http auth token + subprocess env secrets)
4. ⏳ Codex OAuth flow (PKCE + local callback) without API keys; use fixed Codex CLI auth URL and client_id
5. Document Codex callback URL and troubleshooting (redirect mismatch, local callback binding)
6. ✅ Claude Code subprocess worker (CLI wrapper) + Hire UI wiring
7. Document Claude Code setup-token + CLI install requirements
8. ✅ Codex CLI worker (openai-codex wrapper) + Hire UI wiring
9. Document Codex CLI login + OAuth troubleshooting

---

## Phase 6: Agent Organization OS (Architecture Shift)

**Status:** ✅ Complete

**Goal:** Transform Clutch from "multi-agent messaging" to "Agent Organization OS" - treating agents as employees with personalities, memory, and structured collaboration.

> **Reference:** `docs/Agent_Organization_Guide.md` is the source of truth for this paradigm.

### Philosophy Shift

| Old Mental Model | New Mental Model |
|-----------------|------------------|
| Agents chat with each other | Agents work on tasks, control plane mediates |
| Agents are always-on | Agents wake for tasks, sleep between |
| Capabilities define agents | Personality + strengths + rules define agents |
| Free-form messaging | All work attached to tasks |
| Individual memory | Structured memory model (WORKING/MEMORY) |

### Tasks

#### 6.1 AgentSpec Model
- [x] Extend agent config beyond capabilities:
  - `personality` - Communication style, decision-making approach
  - `strengths` - What this agent excels at (vs just what it can do)
  - `operating_rules` - Constraints and guidelines for behavior
  - `preferred_collaborators` - Who this agent works best with
- [x] Update `config/org.yaml` schema for new fields
- [x] Update agent registry to store and query new fields
- [x] AgentSpec validation in clutchd (via Zod schemas in protocol package)

#### 6.2 Heartbeat System (Agent Lifecycle)
- [x] Ban "always-on" agents - agents must be explicitly woken
- [x] Implement agent wakeup triggers:
  - Task assignment → wake agent
  - Scheduled time (daily standup) → wake agent
  - Review request → wake agent
- [x] Agent isolation between wakeups (no state persistence in runtime)
- [x] Define agent session lifecycle: `wake → work → sleep`
- [x] Session timeout and cleanup
- [ ] Container-per-session model (requires integration with ContainerManager)

#### 6.3 Memory Model
- [x] Create `/memory/` directory structure per agent:
  - `/memory/WORKING.md` - Current task context (session-scoped)
  - `/memory/daily/YYYY-MM-DD.md` - Daily log
  - `/memory/MEMORY.md` - Long-term knowledge base
- [x] WORKING.md lifecycle:
  - Created fresh on task assignment
  - Agent updates during work
  - Archived on task completion
- [x] Daily log auto-generation from task activities
- [x] MEMORY.md summarization from completed work
- [ ] Memory sync between workspace and clutchd

#### 6.4 Task-Centric Collaboration
- [x] All messages must reference a `task_id` (enforced in message-bus.ts)
- [ ] Remove channel-based messaging (or make it task-scoped)
- [ ] All artifacts attached to tasks (not standalone)
- [ ] All documents stored under task hierarchy
- [ ] Task as the unit of accountability and billing

#### 6.5 Control Plane Pattern
- [x] Refactor agent registry with strength-based queries
- [x] Refactor message flow: agents → control plane → agents (via message-bus)
- [x] Control plane wakes agents before delivery
- [x] Control plane decides routing based on:
  - Task requirements
  - Agent availability (awake/asleep)
  - Agent strengths (not just capabilities)
  - Workload balancing
- [x] Strength-based routing fallback when capability matching fails
- [ ] All state lives in control plane, agents are stateless executors

#### 6.6 Daily Standup Automation
- [x] Scheduled task at configured time (e.g., 9:00 AM)
- [x] Collect from each agent:
  - What was completed yesterday
  - What's planned for today
  - Blockers (escalated to PM)
- [x] Generate standup summary as markdown
- [x] Store in `/memory/daily/` for each agent
- [ ] Display in UI as team activity feed

#### 6.7 UI Updates
- [x] Agent view shows personality/strengths, not just capabilities
- [ ] Task view as primary navigation (not channels)
- [ ] Daily standup view with team summary
- [ ] Agent memory browser (view WORKING.md, MEMORY.md)
- [x] Wake/sleep status indicators (lifecycle state icons)

### Deliverables

- [x] AgentSpec schema with personality, strengths, operating_rules
- [x] Heartbeat system with wake/work/sleep lifecycle
- [x] Memory model with WORKING.md and MEMORY.md
- [x] Task-centric collaboration (task_id enforcement)
- [x] Control plane pattern (message-bus routes all messages, wakes agents)
- [x] Daily standup automation
- [x] Updated UI for organization-centric view (personality, strengths, lifecycle state)

### Files Created/Updated

- `packages/protocol/src/agent.ts` - AgentSpec types (AgentPersonality, AgentStrength, OperatingRule, MemoryConfig)
- `packages/core/src/router.ts` - Added getHandler() method for direct handler access
- `apps/clutchd/src/services/agent-session.ts` - Agent wake/work/sleep lifecycle management
- `apps/clutchd/src/services/agent-memory.ts` - Memory model (WORKING.md, daily logs, MEMORY.md)
- `apps/clutchd/src/services/daily-standup.ts` - Daily standup automation
- `apps/clutchd/src/services/message-bus.ts` - Enhanced with task-centric enforcement, agent wake-on-delivery, strength-based routing
- `apps/clutchd/src/db/schema.ts` - Extended agents table with AgentSpec fields and lifecycle state
- `apps/clutchd/src/repositories/agents.ts` - Strength-based queries, lifecycle methods
- `apps/web/src/types/index.ts` - Added AgentLifecycleState, AgentPersonality, StandupEntry, TeamStandup types
- `apps/web/src/components/AgentsView.tsx` - Updated to show personality, strengths, operating rules, lifecycle state
- `config/org.yaml` - Updated with personality, strengths, operating_rules for all agents
- `docs/Agent_Organization_Guide.md` - Full reference documentation for Organization OS paradigm

### Migration Notes

Current agent configuration:
```yaml
# Current (capabilities-focused)
agents:
  - id: agent:research
    name: Research
    capabilities: [skill:research]
    tools: [mcp:browser]
```

New agent configuration:
```yaml
# New (organization-focused)
agents:
  - id: agent:research
    name: Ken
    role: research

    # NEW: Personality and behavior
    personality:
      style: analytical
      communication: concise
      decision_making: data-driven

    strengths:
      - market_analysis
      - competitive_intelligence
      - trend_identification

    operating_rules:
      - Always cite sources
      - Provide confidence levels
      - Escalate if data is stale (>30 days)

    # Existing
    capabilities: [skill:research]
    tools: [mcp:browser]

    # NEW: Memory configuration
    memory:
      working_limit: 50KB
      daily_retention: 30d
      long_term_summary: weekly
```

---

## Phase 2.5: Clutch Protocol Implementation (PRIORITY)

**Status:** In Progress

**Goal:** Implement the Clutch Protocol v0 as the foundation for all inter-agent communication.

> **Reference:** `docs/Clutch_Protocol_v0.md` is the source of truth.

### Tasks

#### 2.5.1 Protocol Package
- [x] Create `packages/protocol/` shared package
- [ ] Define ClutchMessage schema (Zod) with all fields:
  - Core: `v`, `id`, `ts`, `from`, `to`, `type`, `payload`
  - Hierarchy: `thread_id`, `run_id`, `task_id`, `parent_task_id`
  - Type system: `domain`, `payload_type`, `schema_ref`
  - Routing: `requires[]`, `prefers[]`
  - Delivery: `idempotency_key`, `attempt`
  - Security: `auth`, `policy`
- [x] Define AgentCard schema with capability model
- [x] Define all message types: `task.*`, `chat.*`, `tool.*`, `agent.*`, `routing.*`
- [x] Export protocol types for use across packages

#### 2.5.2 Schema Registry
- [x] Design schema registry structure
- [ ] Implement built-in payload types:
  - `research.summary.v1`, `research.sources.v1`
  - `code.output.v1`, `code.review.v1`
  - `review.feedback.v1`
- [x] Add workflow-scoped validation rules
- [x] Schema versioning support

#### 2.5.3 Event Store
- [x] Design append-only event store schema
- [x] Primary key: `msg.id`, indexes: `run_id`, `thread_id`, `task_id`
- [x] Implement event replay by `run_id`
- [x] Add artifact store (content-addressed)
- [x] Deduplication: `(run_id, msg.id)` scope

#### 2.5.4 Agent Registry (Protocol-compliant)
- [x] Implement AgentCard-based registration
- [x] Capability model with `id`, `version`, `tags`, `tools`, `trust_level`, `cost_hint`
- [x] Endpoint management (a2a, clutch URLs)
- [x] Limits enforcement (max_concurrency, max_runtime_sec)
- [x] Heartbeat and health tracking

#### 2.5.5 Capability Matching & Routing
- [x] Implement matching algorithm:
  - Hard filters (security, allowlist, limits)
  - Required capabilities (`requires[]`, AND semantics)
  - Preference scoring (`prefers[]`, weighted)
  - Tie-breakers (load, success rate, round-robin)
- [x] Emit `routing.decision` events
- [x] Task hierarchy: `run_id` / `task_id` / `parent_task_id`
- [x] Addressing: `agent:<name>`, `group:<name>`

#### 2.5.6 Delivery & Retry
- [x] At-least-once delivery
- [x] Deduplication by `msg.id` and `idempotency_key`
- [x] Retry with `attempt` tracking
- [x] Error responses with `retryable` flag

#### 2.5.7 Adapter System
- [x] Define Adapter interface (`canHandle`, `inbound`, `outbound`)
- [x] Implement MCP adapter for tool calling
- [x] Create A2A adapter stub
- [x] HTTP webhook adapter

#### 2.5.8 Security Layer
- [ ] Message authentication (ed25519 signing)
- [ ] Policy enforcement (sandbox, tool_allowlist)
- [ ] Network egress control

### Deliverables

- [x] `packages/protocol/` with all type definitions
- [x] Schema registry with workflow validation
- [x] Append-only event store (in-memory)
- [x] AgentCard-based agent registry
- [x] Capability matching router with decision events
- [x] Working adapter interface
- [x] MCP adapter

### Migration Notes

Legacy message types map to protocol types:

| Legacy | Protocol | Domain | Payload Type |
|--------|----------|--------|--------------|
| `PLAN` | `task.request` | `planning` | `plan.outline.v1` |
| `PROPOSAL` | `task.result` | varies | `*.proposal.v1` |
| `EXEC_REPORT` | `task.result` | varies | `*.output.v1` |
| `REVIEW` | `task.result` | `review` | `review.feedback.v1` |
| `BLOCKER` | `task.error` | - | error payload |

---

## Phase 7: RimWorld Colony UI

**Status:** ✅ Complete (MVP)

**Goal:** Add a RimWorld-style top-down colony view showing agents as pixel pawns in an office map.

### Tasks

#### 7.1 Pixi.js Setup
- [x] Add `pixi.js` v8.x dependency
- [x] Colony types (MapZone, PawnState, ColonyEvent)
- [x] Constants (tile size, zone definitions, role colors, desk positions)
- [x] Procedural sprite generation (pawns, desks, floors, selection rings)

#### 7.2 Core Rendering
- [x] OfficeMap (Pixi.js Container) - floor grid, zone rooms, furniture
- [x] AgentPawn (Pixi.js Container) - body, name, status bar, activity bubble
- [x] Pawn animations: idle bobbing, walking lerp, sleeping ZZZ, progress bar
- [x] ColonyEngine orchestrator - manages app, map, pawns, animations, events

#### 7.3 React Integration
- [x] `useColonyEngine` hook - lifecycle, store subscription, ResizeObserver
- [x] Colony Zustand store (speed, selection, events)
- [x] Feed agent/task data from main store to engine

#### 7.4 HUD Overlays
- [x] EventTicker (top) - scrolling event bar
- [x] TaskQueuePanel (right) - active tasks list
- [x] AgentInfoPanel (bottom) - selected agent details
- [x] ColonyControls (bottom-right) - speed buttons

#### 7.5 App Integration
- [x] Route: `/colony` → `ColonyView`
- [x] Sidebar link to Colony View

### Deliverables

- [x] `/colony` route renders Pixi.js canvas with office map
- [x] 5 seed agents appear as colored pawns
- [x] Pawns animate based on lifecycle state
- [x] Click pawn → info panel with agent details
- [x] Event ticker, task queue, speed controls

### Files Created

- `apps/web/src/colony/types.ts` - Colony type definitions
- `apps/web/src/colony/constants.ts` - Layout constants, role colors, zone definitions
- `apps/web/src/colony/sprites.ts` - Procedural sprite generation
- `apps/web/src/colony/OfficeMap.ts` - Office floor plan renderer
- `apps/web/src/colony/AgentPawn.ts` - Agent pawn with animations
- `apps/web/src/colony/ColonyEngine.ts` - Pixi.js orchestrator
- `apps/web/src/colony/useColonyEngine.ts` - React integration hook
- `apps/web/src/store/colony.ts` - Colony-specific Zustand store
- `apps/web/src/components/colony/ColonyView.tsx` - Main colony route
- `apps/web/src/components/colony/EventTicker.tsx` - Event ticker overlay
- `apps/web/src/components/colony/TaskQueuePanel.tsx` - Task queue panel
- `apps/web/src/components/colony/AgentInfoPanel.tsx` - Agent info panel
- `apps/web/src/components/colony/ColonyControls.tsx` - Speed controls

---

## Phase 8: Clutch Runtime Compliance (Spec v0)

**Status:** Not Started

**Goal:** Align Clutch with the Agent Organization Runtime spec: shared state, append-only event log, role gates, and runtime-agnostic pull/run/push.

### Tasks

#### 8.1 Shared State Model
- [ ] Define `org_state` + `project_state` schemas
- [ ] Add reducers to derive state from events
- [ ] Document state derivation and promotion rules

#### 8.2 Append-Only Event Log
- [ ] Enforce write-once event store (no updates/deletes)
- [ ] Base event schema with `id`, `type`, `actor_agent_id`, `timestamp`, `refs[]`, `payload`, `cost`
- [ ] Required event types (TASK_CREATED, TASK_ASSIGNED, ARTIFACT_PRODUCED, TEST_RUN, PR_OPENED, REVIEW_COMMENTED, MERGE_APPROVED, MERGE_BLOCKED, EVAL_REPORTED, HIRING_PROPOSAL, FIRING_PROPOSAL, DECISION_RECORDED, BUDGET_UPDATED)

#### 8.3 Role-Based Gates
- [ ] Add role taxonomy (CEO/HR/Senior/Junior) to agent schema
- [ ] Enforce Junior→Senior review gates
- [ ] Enforce Senior-only merge approvals

#### 8.4 Runtime Interface Contract
- [ ] Implement `pull()/run()/push()` for in-process, http, subprocess runtimes
- [ ] Ensure all runtimes emit events via the same event log

#### 8.5 HR & CEO Flows (v1)
- [ ] Scorecard windowing + `EVAL_REPORTED`
- [ ] Hiring/firing proposal events and CEO decisions
- [ ] Budget update events and enforcement

#### 8.6 Protocol/Storage Drift Fixes
- [ ] Persist `security` (auth/policy) on messages and expose via API
- [ ] Add `schema_ref` + `payload_type` handling to message APIs and storage
- [ ] Enforce workflow-scoped payload validation using `packages/protocol/src/schemas.ts`
- [ ] Fix dedupe semantics (use `(run_id, msg.id)`; keep idempotency_key distinct)

#### 8.7 Append-Only Enforcement
- [ ] Remove/guard delete endpoints for messages, tasks, channels, artifacts (or gate behind dev-only flag)
- [ ] Remove delete methods from repositories or hard-block outside tests
- [ ] Add database constraints or policies to prevent message updates/deletes

#### 8.8 Role Taxonomy & Gates
- [ ] Expand roles to include CEO/HR/Senior/Junior (update schema, types, seed data)
- [ ] Enforce Junior→Senior review gating in review routes/workflow engine
- [ ] Enforce Senior-only merge approvals (new `MERGE_APPROVED`/`MERGE_BLOCKED` events)

#### 8.9 AgentCard/Registry Alignment
- [ ] Map `agents.endpoints` to AgentCard endpoints (clutch/a2a/http/websocket)
- [ ] Store and surface AgentCard `security` allow/deny lists per agent

#### 8.10 Docs Sync
- [ ] Update README architecture diagram (remove OpenClaw pool, reflect runtime abstraction)
- [ ] Reconcile Agent Organization Guide checklist with implemented code paths

### Deliverables

- [ ] Event-sourced shared state with append-only log
- [ ] Role gates enforced in task/review flows
- [ ] Runtime-agnostic pull/run/push contract implemented
- [ ] HR/CEO governance workflows emitting decisions to event log

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-01-31 | Initial plan created | Claude |
| 2026-01-31 | Phase 0 completed - monorepo setup, web UI skeleton, clutchd skeleton, docker-compose, configs | Claude |
| 2026-01-31 | Phase 1 completed - Drizzle schema, migrations, repositories, Redis queue, seed script | Claude |
| 2026-02-01 | Phase 2 completed - Full REST API, correlation IDs, agent registry, task state machine, message validation, workflow engine, budget service, WebSocket real-time updates | Claude |
| 2026-02-01 | Added Phase 2.5 (Clutch Protocol Implementation) as priority - protocol spec reviewed, docs updated | Claude |
| 2026-02-01 | Refined Clutch Protocol v0 - added task hierarchy, schema registry, capability matching, delivery semantics | Claude |
| 2026-02-01 | Created packages/protocol, packages/core, packages/adapters implementing Clutch Protocol v0 | Claude |
| 2026-02-01 | Added A2A and MCP comparison section to Clutch Protocol docs and README | Claude |
| 2026-02-01 | **MAJOR REFACTOR:** Removed legacy code, updated clutchd to use Clutch Protocol types. New schema with protocol-compliant message types, task hierarchy (run_id/task_id/parent_task_id), artifacts table, and proper indexes | Claude |
| 2026-02-01 | Integrated packages/core with clutchd: PostgreSQL-backed EventStore, MessageBus with MessageRouter, ArtifactStore with content-addressed storage, artifact API routes, workflow engine updated for protocol compliance | Claude |
| 2026-02-02 | **Phase 3 Complete:** Docker container runtime (ContainerManager), tool permissions (PermissionChecker with sandbox/prod modes), agent communication (AgentClient, agent-callbacks routes), agent worker service (task queue consumer, result processor) | Claude |
| 2026-02-02 | **Phase 4 Complete:** Web UI with React/TypeScript, WebSocket real-time updates, Zustand state management, React Query data fetching, task management with review interface, agent dashboard, channel views with Clutch Protocol message types | Claude |
| 2026-02-02 | **Phase 6 Added:** Agent Organization OS - paradigm shift from multi-agent messaging to treating agents as employees with personality, memory, and task-centric collaboration. New concepts: AgentSpec, Heartbeat system, Memory model (WORKING.md/MEMORY.md), Control plane pattern, Daily standup automation | Claude |
| 2026-02-02 | **Phase 6 Progress:** Implemented AgentSpec model (personality, strengths, operating_rules in protocol/agent.ts), Heartbeat system (agent-session.ts with wake/work/sleep lifecycle), Memory model (agent-memory.ts with WORKING.md, daily logs, MEMORY.md), Daily standup automation (daily-standup.ts). Updated DB schema and agent repository with strength-based queries and lifecycle methods. Updated org.yaml with personality/strengths for all agents | Claude |
| 2026-02-02 | **Phase 6 Complete:** Task-centric collaboration (task_id enforcement in message-bus), Control plane pattern (wake-on-delivery, strength-based routing fallback), UI updates (AgentsView shows personality/strengths/lifecycle state, new types for standup/memory). All major Phase 6 deliverables complete | Claude |
| 2026-02-02 | **Phase 5 Complete:** Created `packages/agents/` with full MVP agent implementations. PM agent (task decomposition, agent assignment, progress monitoring), Research agent (web search, fact-checking, synthesis with citations), Marketing agent (copy generation, landing pages, A/B variants), Developer agent (code gen, file ops, git integration). All agents use LLM abstraction supporting OpenAI/Anthropic | Claude |
| 2026-02-02 | **Phase 6 Integration Complete:** Agent executor bridges control plane with agents, agent worker integrated with real LLM execution, workflow engine uses Clutch Protocol types, E2E demo script created (`scripts/demo-e2e.ts`), Makefile updated with `make demo` command. All MVP success criteria met | Claude |
| 2026-02-02 | **Package manager migration:** Switched from pnpm to bun for faster installs and better DX. Updated package.json, Makefile, CLAUDE.md, demo scripts. Removed pnpm-workspace.yaml | Claude |
| 2026-02-03 | **Build simplification:** Packages now export source .ts files directly (no build step, no .d.ts files needed). Removed agents/openclaw (unused). Cleaned up duplicate code patterns. Bun handles TypeScript natively | Claude |
| 2026-02-08 | **Agent Runtime Abstraction (P0):** Added pluggable `AgentRuntime` interface with `InProcessRuntime`, `HttpRuntime`, and `SubprocessRuntime`. Refactored `AgentExecutorService` to use runtime registry. Added `runtime` column to DB schema. Updated org.yaml and seed data | Claude |
| 2026-02-08 | **RimWorld Colony UI (Phase 7):** Added Pixi.js-based top-down colony view at `/colony`. Office map with zones, agent pawns with animations (idle bobbing, walking, sleeping ZZZ), HUD overlays (event ticker, task queue, agent info panel, speed controls). Zustand store for colony state | Claude |
| 2026-02-08 | **PLAN.md audit:** Fixed Phase 3 status (Docker runtime was removed, marked as partial). Added Phase 7 for Colony UI. Updated current focus section | Claude |
| 2026-02-08 | **Spec drift audit:** Added Phase 8 tasks for protocol/storage alignment, append-only enforcement, role gates, and docs sync | Claude |

---

## Notes

- **Clutch Protocol v0** (`docs/Clutch_Protocol_v0.md`) is the source of truth for all inter-agent communication
- Technology stack: bun workspaces, Vite + React + Tailwind (web), Fastify + Drizzle (clutchd), Dockerode (agents)
- Database: PostgreSQL with Drizzle ORM, migrations in `apps/clutchd/drizzle/`
- Queue: Redis with ioredis, pub/sub for real-time events
- All message types now follow Clutch Protocol: `task.*`, `chat.*`, `tool.*`, `agent.*`, `routing.*`
- Framework adapters (A2A, MCP) enable support for LangGraph, AutoGen, crewAI, and other agent frameworks
