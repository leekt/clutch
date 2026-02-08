# Agent Organization Guide

Clutch treats AI agents as **employees in an organization** rather than isolated prompts or chat participants. This guide defines the philosophical and technical foundations of this approach.

---

## Philosophy: From Chat to Organization

### The Problem with "Multi-Agent Chat"

Traditional multi-agent systems treat agents like chat participants:
- Agents message each other directly
- Always-on, waiting for messages
- Unstructured conversations
- Memory scattered across chat history

This leads to:
- **Coordination chaos** - Who's working on what?
- **State confusion** - What's the current status?
- **Accountability gaps** - Who made this decision?
- **Resource waste** - Agents running 24/7 for occasional work

### The Organization Model

Clutch models an **AI organization**:
- Agents are employees with roles and specialties
- Work is organized into tasks with clear ownership
- A control plane (like management) coordinates everything
- Agents wake for work, then rest

---

## Core Principles

### 1. Control Plane Mediates Everything

```
       ┌─────────────────────────────────────┐
       │         Control Plane (clutchd)     │
       │   ┌───────────────────────────┐     │
       │   │ Shared State:             │     │
       │   │ - Task status             │     │
       │   │ - Agent availability      │     │
       │   │ - Routing decisions       │     │
       │   └───────────────────────────┘     │
       └─────────────────────────────────────┘
              ▲           ▲           ▲
              │           │           │
         ┌────┴───┐  ┌────┴───┐  ┌────┴───┐
         │ Agent  │  │ Agent  │  │ Agent  │
         │ (Ken)  │  │ (Dev)  │  │ (QA)   │
         └────────┘  └────────┘  └────────┘
```

**Agents never talk directly to each other.** All communication flows through the control plane:

| Old Pattern | New Pattern |
|-------------|-------------|
| `Agent A → Agent B` | `Agent A → Control Plane → Agent B` |
| Agents maintain peer connections | Control plane maintains single source of truth |
| Agents decide who to talk to | Control plane decides routing |

**Benefits:**
- Single source of truth for all state
- Observable routing decisions
- Workload balancing
- Security enforcement

### 2. Agents Are Not Always-On

Agents operate on a **heartbeat model**:

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│ ASLEEP  │ ───── wake ──────► │ WORKING │ ───── sleep ─────► │ ASLEEP  │
└─────────┘                    └─────────┘                    └─────────┘
     │                              │
     │                              ▼
     │                         ┌─────────┐
     │                         │ timeout │
     │                         └─────────┘
     │                              │
     └──────────────────────────────┘
```

**Wake triggers:**
- Task assignment
- Scheduled time (daily standup)
- Review request
- Explicit human request

**Session isolation:**
- Each wake creates a fresh session
- No runtime state persists between sessions
- Only memory files persist (WORKING.md, MEMORY.md)

**Benefits:**
- Resource efficiency (no idle agents)
- Clean state (no accumulated cruft)
- Predictable behavior
- Cost control

### 3. Tasks Are Central

**All work attaches to a task_id.** There are no orphan messages, documents, or artifacts.

```
Task: task_abc123
├── Messages
│   ├── task.request (from PM)
│   ├── task.accept (from Research)
│   ├── task.progress (from Research)
│   └── task.result (from Research)
├── Artifacts
│   ├── artifact:report_456 (research output)
│   └── artifact:sources_789 (bibliography)
└── Reviews
    └── review_xyz (QA feedback)
```

**Task lifecycle:**
```
created → assigned → running → review → (rework) → done
                                 ↓
                             rejected → rework → review (loop)
```

**Benefits:**
- Clear accountability
- Accurate cost attribution
- Reproducible workflows
- Clean audit trails

### 4. Structured Memory Model

Each agent has a structured memory in `/memory/`:

```
/memory/
├── WORKING.md           # Current task context
├── daily/
│   ├── 2026-02-01.md    # Yesterday's activity
│   └── 2026-02-02.md    # Today's activity
└── MEMORY.md            # Long-term knowledge
```

#### WORKING.md (Session-Scoped)

Created fresh when a task is assigned:

```markdown
# Current Task

**Task ID:** task_abc123
**Title:** Research competitor pricing
**Started:** 2026-02-02T10:30:00Z

## Context

Assigned by PM to research pricing strategies of top 3 competitors.

## Progress

- [x] Identified competitors: Acme, Beta, Gamma
- [x] Found Acme pricing page
- [ ] Analyze Beta pricing
- [ ] Analyze Gamma pricing

## Notes

- Acme uses tiered pricing with 3 plans
- Need to check if Beta has enterprise pricing
```

Lifecycle:
1. Created fresh on task assignment
2. Updated by agent during work
3. Archived with task on completion

#### Daily Log (daily/YYYY-MM-DD.md)

Auto-generated from task activities:

```markdown
# 2026-02-02

## Completed Tasks

- **task_abc123** Research competitor pricing (3.2 hours)
  - Delivered: artifact:report_456
  - Cost: $0.45

## In Progress

- **task_def456** Draft marketing copy
  - Status: waiting for review

## Blockers

None

## Standup Summary

Completed competitor research for PM. Starting marketing copy draft.
Expect to finish by EOD.
```

#### MEMORY.md (Long-Term)

Summarized knowledge that persists across tasks:

```markdown
# Agent Memory: Ken (Research)

## Domain Knowledge

### Competitor Intelligence

- **Acme Corp**: Enterprise focus, tiered pricing ($99/$299/$999)
- **Beta Inc**: SMB focus, usage-based pricing
- **Gamma Ltd**: Freemium model, premium at $49/mo

Last updated: 2026-02-02

### Market Trends

- AI tools market growing 35% YoY
- Key differentiator: ease of integration

## Lessons Learned

- Always check Internet Archive for historical pricing
- Industry reports often gated; use press releases as proxy
```

### 5. AgentSpec Beyond Capabilities

Traditional capability model:
```yaml
agent:
  capabilities: [skill:research, tool:browser]
```

**Organization model adds:**

```yaml
agent:
  id: agent:ken
  name: Ken
  role: research

  # Personality (how the agent behaves)
  personality:
    style: analytical        # vs creative, systematic, etc.
    communication: concise   # vs verbose, formal, casual
    decision_making: data-driven  # vs intuitive, consensus-seeking

  # Strengths (what it excels at, beyond raw capabilities)
  strengths:
    - market_analysis
    - competitive_intelligence
    - trend_identification
    - source verification

  # Operating rules (behavioral constraints)
  operating_rules:
    - Always cite sources with URLs
    - Provide confidence levels (high/medium/low)
    - Escalate if data is stale (>30 days old)
    - Never speculate without marking as speculation
    - Prefer primary sources over secondary

  # Traditional capabilities (what tools it can use)
  capabilities:
    - skill:research
    - tool:mcp

  # Collaboration preferences
  preferred_collaborators:
    - agent:pm           # for task clarification
    - agent:marketing    # for copy review

  # Memory configuration
  memory:
    working_limit: 50KB
    daily_retention: 30d
    long_term_summary: weekly
```

**Routing uses strengths, not just capabilities:**

| Task Requirement | Old Routing | New Routing |
|-----------------|-------------|-------------|
| "Research competitor pricing" | Any agent with `skill:research` | Agent with `strength:competitive_intelligence` |
| "Verify data accuracy" | Any researcher | Agent with `strength:source_verification` |

---

## Daily Standup Automation

At configured time (e.g., 9:00 AM), the control plane:

1. **Wakes each active agent**
2. **Requests standup update:**
   - What was completed yesterday?
   - What's planned for today?
   - Any blockers?

3. **Generates team summary:**
   ```markdown
   # Daily Standup - 2026-02-02

   ## Ken (Research)
   - Completed: Competitor pricing analysis
   - Today: Market trend report
   - Blockers: None

   ## Dev (Developer)
   - Completed: API integration
   - Today: Unit tests
   - Blockers: Waiting on QA review

   ## QA (Quality)
   - Completed: Review of marketing copy
   - Today: Review API integration
   - Blockers: None
   ```

4. **Stores in daily logs**
5. **Escalates blockers to PM**

---

## Implementation Checklist

### Control Plane Updates

- [ ] Refactor message routing to always go through control plane
- [ ] Add routing based on strengths (not just capabilities)
- [ ] Implement agent wake/sleep lifecycle
- [ ] Add session isolation (no state between wakes)

### Agent Model Updates

- [ ] Extend AgentCard with personality, strengths, operating_rules
- [ ] Update org.yaml schema
- [ ] Add preferred_collaborators field
- [ ] Implement memory configuration

### Memory System

- [ ] Create /memory/ directory structure
- [ ] Implement WORKING.md lifecycle
- [ ] Auto-generate daily logs
- [ ] Build MEMORY.md summarization

### Task-Centric Refactor

- [ ] Enforce task_id on all messages
- [ ] Remove channel-based messaging (or make task-scoped)
- [ ] Attach all artifacts to tasks
- [ ] Add task-level billing

### Daily Standup

- [ ] Implement scheduled wake
- [ ] Create standup prompt template
- [ ] Build summary generator
- [ ] Add escalation for blockers

### UI Updates

- [ ] Show personality/strengths in agent view
- [ ] Make task view primary (not channels)
- [ ] Add daily standup view
- [ ] Add memory browser
- [ ] Show wake/sleep status

---

## Migration Guide

### From Current to Organization Model

1. **Update agent configs** - Add personality, strengths, operating_rules
2. **Refactor routing** - Use control plane pattern
3. **Add memory directories** - Create /memory/ structure
4. **Update message flow** - Require task_id on all messages
5. **Implement heartbeat** - Add wake/sleep lifecycle
6. **Build standup automation** - Scheduled daily process

### Backwards Compatibility

During migration:
- Legacy agents can still work (treated as always-on)
- Old message format still accepted
- Gradual adoption of new features

---

## FAQ

**Q: Why not let agents talk directly?**
A: Direct agent-to-agent messaging creates coordination chaos. The control plane provides a single source of truth and enables observability.

**Q: Why wake/sleep instead of always-on?**
A: Always-on agents waste resources and accumulate state. Wake/sleep ensures clean sessions and cost control.

**Q: How is this different from a workflow engine?**
A: Workflow engines define fixed paths. Clutch agents have autonomy within their operating_rules—they decide *how* to complete tasks, not *what* tasks to do.

**Q: Can agents have persistent memory?**
A: Yes, through MEMORY.md. But runtime state (variables, connections) is cleared between sessions.

**Q: How do agents collaborate if they can't talk directly?**
A: Through tasks. Agent A creates a subtask for Agent B. The control plane routes it. Results flow back the same way.
