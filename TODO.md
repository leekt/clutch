# TODO.md

Current priorities and next steps for Clutch.

**Last Updated:** 2026-02-08

---

## P0: Clutch Runtime Compliance (Spec v0)

Bring core runtime and governance in line with the "Agent Organization Runtime" spec.

- [ ] **Shared state layers** — Add explicit `org_state`, `project_state`, `agent_state` stores; document derivation from events
- [ ] **Append-only event log** — Enforce write-once event store; add event schema with `cost`, `refs`, `actor_agent_id`
- [ ] **Required event types** — Emit: TASK_CREATED/ASSIGNED, ARTIFACT_PRODUCED, TEST_RUN, PR_OPENED, REVIEW_COMMENTED, MERGE_APPROVED/BLOCKED, EVAL_REPORTED, HIRING/FIRING_PROPOSAL, DECISION_RECORDED, BUDGET_UPDATED
- [ ] **Role-based gates** — Enforce Junior→Senior review gates and Senior-only merge approvals
- [ ] **Runtime interface** — Implement `pull()/run()/push()` contract for all runtimes (in-process, http, subprocess)
- [ ] **Cost accounting** — Standardize token/compute cost fields on all events and rollups

## P0: Agent Runtime Abstraction (Internal)

The biggest architectural gap. `AgentExecutorService` hardcodes 4 in-process agents with no isolation or pluggability.

- [ ] **Runtime interface** — Replace hardcoded `new PMAgent()` etc. with a pluggable runtime interface (in-process, Docker, HTTP, subprocess)
- [ ] **Runtime registry** — `AgentExecutorService` becomes a registry that selects runtime per-agent based on config
- [ ] **HTTP/webhook runtime** — Agents reachable via HTTP endpoint, enabling any language/framework to be a Clutch agent
- [ ] **Agent config `runtime` field** — Add runtime type to `org.yaml` agent definitions (e.g., `runtime: docker`, `runtime: http`, `runtime: subprocess`)

## P1: Container & Process Runtimes

- [ ] **Docker runtime** — Container-per-session: spin up, mount workspace, execute, tear down (bring back `ContainerManager` properly)
- [x] **Subprocess runtime** — Run agents as child processes (Claude Code, Python scripts, Node scripts)
- [ ] **Container-per-session model** — Wire agent sessions (`agent-session.ts`) to actually spawn/destroy containers

## P1: Secrets & OAuth

- [x] **Secrets vault** — Encrypted storage for OAuth/API tokens (CLUTCH_SECRET_KEY)
- [x] **Runtime secret refs** — Resolve secret refs into runtime env/auth
- [x] **Codex OAuth** — PKCE flow with fixed Codex CLI auth URL/client_id; local callback on `http://localhost:1455/auth/callback`
- [ ] **Docs** — Troubleshooting for redirect_uri mismatch + local callback binding

## P1: Claude Code

- [x] **Claude Code worker** — Subprocess wrapper that calls `claude -p` with JSON output
- [ ] **Docs** — Setup-token/login instructions and tool permission mapping

## P1: Codex

- [x] **Codex CLI worker** — Subprocess wrapper that calls `codex` in a PTY
- [ ] **Docs** — Codex CLI login + OAuth troubleshooting

## P1: Governance & Roles

- [ ] **Role taxonomy** — Add CEO/HR/Senior/Junior roles to agent schema and UI
- [ ] **Decision logging** — `DECISION_RECORDED` events for CEO policy/budget actions
- [ ] **HR scorecards** — Implement scorecard windowing + periodic `EVAL_REPORTED`
- [ ] **Hiring/firing proposals** — Emit proposal events, require CEO decision

## P1: State Derivation

- [ ] **State reducers** — Derive `org_state` and `project_state` from event log
- [ ] **Task graph** — Task dependency graph derived from TASK_* events
- [ ] **Artifact registry** — Attach artifacts to tasks only; enforce task linkage

## P2: Framework Adapters & Discovery

- [ ] **LangGraph adapter** — Translate LangGraph state graphs to/from ClutchMessage
- [ ] **CrewAI adapter** — Bridge CrewAI crews into Clutch orchestration
- [ ] **AutoGen adapter** — Bridge AutoGen agents into Clutch orchestration
- [ ] **Dynamic agent discovery** — Agents register themselves via AgentCard at startup instead of being hardcoded in `org.yaml`

## P3: Remote Agents

- [ ] **Remote HTTP agents** — Agents running on other machines/clouds via Clutch protocol over HTTP
- [ ] **A2A federation** — Full A2A adapter for cross-org agent communication

---

## Incomplete Items from PLAN.md

Carried over from Phase 2.5 and Phase 6:

### Protocol & Validation
- [ ] Full ClutchMessage Zod schema with all fields (`domain`, `payload_type`, `schema_ref`, `security`, etc.)
- [ ] Built-in payload types (`research.summary.v1`, `code.output.v1`, `review.feedback.v1`)

### Security
- [ ] Message authentication (ed25519 signing)
- [ ] Policy enforcement (sandbox, tool_allowlist)
- [ ] Network egress control

### Agent Organization OS
- [ ] Memory sync between workspace filesystem and clutchd
- [ ] Remove channel-based messaging or make it task-scoped
- [ ] All artifacts attached to tasks (not standalone)
- [ ] All state lives in control plane, agents are stateless executors

### Web UI
- [ ] Task view as primary navigation (not channels)
- [ ] Daily standup view with team summary
- [ ] Agent memory browser (view WORKING.md, MEMORY.md)
