# TODO.md

Current priorities and next steps for Clutch.

**Last Updated:** 2026-02-08

---

## P0: Agent Runtime Abstraction

The biggest architectural gap. `AgentExecutorService` hardcodes 4 in-process agents with no isolation or pluggability.

- [ ] **Runtime interface** — Replace hardcoded `new PMAgent()` etc. with a pluggable runtime interface (in-process, Docker, HTTP, subprocess)
- [ ] **Runtime registry** — `AgentExecutorService` becomes a registry that selects runtime per-agent based on config
- [ ] **HTTP/webhook runtime** — Agents reachable via HTTP endpoint, enabling any language/framework to be a Clutch agent
- [ ] **Agent config `runtime` field** — Add runtime type to `org.yaml` agent definitions (e.g., `runtime: docker`, `runtime: http`, `runtime: subprocess`)

## P1: Container & Process Runtimes

- [ ] **Docker runtime** — Container-per-session: spin up, mount workspace, execute, tear down (bring back `ContainerManager` properly)
- [ ] **Subprocess runtime** — Run agents as child processes (Claude Code, Python scripts, Node scripts)
- [ ] **Container-per-session model** — Wire agent sessions (`agent-session.ts`) to actually spawn/destroy containers

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
