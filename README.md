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
  - Review rounds  
  - Iteration cycles  

- **Message Cards**  
  - Structured, typed messages instead of free-form chat  

Supported message types:

- `PLAN`
- `PROPOSAL`
- `EXEC_REPORT`
- `REVIEW`
- `BLOCKER`

This makes agent work **auditable, reviewable, and reproducible**.

---

## 6. Strict Communication Protocols

Free-form chat is intentionally disallowed.

Every message must conform to a protocol with required fields:

- Summary
- Body
- Artifacts (path + hash)
- Citations (links, logs)
- Cost and runtime metadata

This enforces:
- Accountability
- Traceability
- Higher output quality

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
