# PLAN.md

Implementation plan for Clutch - tracking progress toward MVP goals.

**Last Updated:** 2026-02-01

---

## MVP Success Criteria (from README.md)

- [ ] Fully automated task flow
- [ ] Review and rejection loops
- [ ] All outputs logged and reproducible
- [ ] Visible collaboration timeline in UI

**End-to-end Scenario:** Product idea → research → landing copy → code implementation → QA review

---

## Phase 0: Project Setup & Infrastructure

**Status:** ✅ Complete

**Goal:** Establish monorepo structure, build tooling, and local development environment.

### Tasks

- [x] Initialize monorepo with pnpm workspaces
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

- [x] Database migrations that can be run with single command (`pnpm --filter clutchd db:migrate`)
- [x] Type-safe data access layer (repositories for all entities)
- [x] Seed script for local development (`pnpm --filter clutchd db:seed`)

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

**Status:** Not Started

**Goal:** Implement agent execution environment with Docker isolation.

### Tasks

#### 3.1 OpenClaw Adapter
- [ ] Research OpenClaw API/protocol
- [ ] Implement adapter interface for agent communication
- [ ] Handle agent responses and convert to Clutch message format

#### 3.2 Docker Runtime
- [x] Agent container image definitions (basic structure)
- [ ] Container lifecycle management (start, stop, health)
- [ ] Volume mounting for workspace and artifacts
- [ ] Network isolation between agents

#### 3.3 Tool Permissions
- [ ] File system access control per agent
- [ ] Shell command allowlist/denylist
- [ ] Git operations control
- [ ] Browser/HTTP access control

#### 3.4 Agent Communication
- [ ] Dispatch tasks to agent containers
- [ ] Receive callbacks/results from agents
- [ ] Stream agent output to clutchd
- [ ] Handle agent failures and retries

### Deliverables

- Agents run in isolated Docker containers
- Tool permissions enforced at runtime
- Agent output captured and stored

---

## Phase 4: Web UI

**Status:** In Progress (skeleton complete)

**Goal:** Build Slack-like collaboration interface.

### Tasks

#### 4.1 Core Layout
- [x] Sidebar with channel list
- [x] Main content area with message feed
- [ ] Thread panel for nested discussions
- [x] Header with org/status info

#### 4.2 Channel Views
- [ ] Task channels (`#task-123-landing-page`)
- [ ] Department channels (`#research`, `#dev`)
- [ ] Channel creation and management
- [ ] Unread indicators

#### 4.3 Message Components
- [x] Message card component with structured display
- [x] Support for all message types (PLAN, PROPOSAL, etc.)
- [x] Artifact display with download links
- [ ] Citation rendering
- [ ] Cost/runtime metadata display

#### 4.4 Real-time Updates
- [ ] WebSocket connection to clutchd
- [ ] Live message streaming
- [ ] Task status updates
- [ ] Agent activity indicators

#### 4.5 Task Management
- [ ] Task creation form
- [ ] Task detail view with full history
- [ ] Task state visualization
- [ ] Review interface (approve/reject with comments)

#### 4.6 Agent Dashboard
- [ ] Agent list with status
- [ ] Agent detail view (permissions, budget, activity)
- [ ] Budget usage visualization

### Deliverables

- Functional Slack-like UI
- Real-time collaboration view
- Task and agent management interfaces

---

## Phase 5: MVP Agents

**Status:** Not Started

**Goal:** Implement the four initial agents for end-to-end scenario.

### Tasks

#### 5.1 PM (Orchestrator) Agent
- [ ] Task decomposition logic
- [ ] Agent assignment decisions
- [ ] Progress monitoring
- [ ] Escalation handling

#### 5.2 Research Agent
- [ ] Web search capabilities
- [ ] Information synthesis
- [ ] Structured research output (PROPOSAL format)
- [ ] Citation collection

#### 5.3 Marketing Agent
- [ ] Copy generation
- [ ] Landing page content creation
- [ ] Brand voice consistency
- [ ] A/B variant generation

#### 5.4 Developer Agent
- [ ] Code generation
- [ ] File creation and modification
- [ ] Git operations
- [ ] Code review response handling

### Deliverables

- Four working agents with defined capabilities
- Each agent produces protocol-compliant outputs
- Agents can participate in review chains

---

## Phase 6: Integration & E2E Flow

**Status:** Not Started

**Goal:** Wire everything together for complete MVP workflow.

### Tasks

- [ ] End-to-end workflow test: idea → research → marketing → dev → review
- [ ] Review chain: PM reviews research, marketing reviews copy, dev reviews code
- [ ] Rejection and rework loops working
- [ ] All actions logged in audit trail
- [ ] Artifacts stored with hashes
- [ ] Timeline visible in UI
- [ ] Budget tracking across full workflow
- [ ] Demo scenario documented and reproducible

### Deliverables

- Complete working MVP
- Demo script for end-to-end scenario
- All success criteria met

---

## Current Focus

**Active Phase:** Phase 2.5 - Clutch Protocol Implementation (PRIORITY)

**Next Action:** Integrate protocol packages with clutchd, add PostgreSQL event store

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
- [ ] Add artifact store (content-addressed)
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

---

## Notes

- **Clutch Protocol v0** (`docs/Clutch_Protocol_v0.md`) is the source of truth for all inter-agent communication
- Technology stack: pnpm workspaces, Vite + React + Tailwind (web), Fastify + Drizzle (clutchd), Dockerode (agents)
- Database: PostgreSQL with Drizzle ORM, migrations in `apps/clutchd/drizzle/`
- Queue: Redis with ioredis, pub/sub for real-time events
- Current Phase 2 implementation uses legacy message types - will be migrated to protocol-compliant types in Phase 2.5
- Framework adapters (A2A, MCP) enable support for LangGraph, AutoGen, crewAI, and other agent frameworks
