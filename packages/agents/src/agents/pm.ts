import pino from 'pino';

import { BaseAgent, type AgentContext, type ExecutionResult, type TaskDispatch } from '../executor/base-agent.js';
import { LLMClient, type LLMMessage, type ToolDefinition } from '../executor/llm-client.js';

const logger = pino({ name: 'agent-pm' });

/**
 * Subtask definition created by PM
 */
interface Subtask {
  title: string;
  description: string;
  assignTo: string; // agent:research, agent:developer, etc.
  requires?: string[];
  prefers?: string[];
  priority: 'high' | 'medium' | 'low';
  dependencies?: string[]; // titles of subtasks this depends on
  estimatedComplexity?: 'simple' | 'moderate' | 'complex';
}

/**
 * Decomposition result
 */
interface DecompositionResult {
  summary: string;
  subtasks: Subtask[];
  timeline?: string;
  risks?: string[];
  assumptions?: string[];
}

/**
 * PM Agent Tools
 */
const PM_TOOLS: ToolDefinition[] = [
  {
    name: 'decompose_task',
    description: 'Break down a complex task into subtasks with agent assignments',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'High-level summary of the decomposition strategy',
        },
        subtasks: {
          type: 'array',
          description: 'List of subtasks to create',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Clear, actionable title' },
              description: { type: 'string', description: 'Detailed description with acceptance criteria' },
              assignTo: {
                type: 'string',
                description: 'Agent to assign (agent:research, agent:marketing, agent:developer, agent:qa)',
                enum: ['agent:research', 'agent:marketing', 'agent:developer', 'agent:qa'],
              },
              priority: {
                type: 'string',
                description: 'Priority level',
                enum: ['high', 'medium', 'low'],
              },
              dependencies: {
                type: 'array',
                description: 'Titles of subtasks this depends on (for sequencing)',
                items: { type: 'string' },
              },
              estimatedComplexity: {
                type: 'string',
                description: 'Estimated complexity',
                enum: ['simple', 'moderate', 'complex'],
              },
            },
            required: ['title', 'description', 'assignTo', 'priority'],
          },
        },
        timeline: {
          type: 'string',
          description: 'Suggested execution timeline/order',
        },
        risks: {
          type: 'array',
          description: 'Potential risks or blockers',
          items: { type: 'string' },
        },
        assumptions: {
          type: 'array',
          description: 'Assumptions made in planning',
          items: { type: 'string' },
        },
      },
      required: ['summary', 'subtasks'],
    },
  },
  {
    name: 'escalate_blocker',
    description: 'Escalate a blocker that needs human attention',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Blocker title' },
        description: { type: 'string', description: 'Detailed description of the blocker' },
        severity: {
          type: 'string',
          description: 'Severity level',
          enum: ['critical', 'high', 'medium'],
        },
        suggestedActions: {
          type: 'array',
          description: 'Suggested actions to resolve',
          items: { type: 'string' },
        },
      },
      required: ['title', 'description', 'severity'],
    },
  },
  {
    name: 'request_clarification',
    description: 'Request clarification on ambiguous requirements',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to clarify' },
        context: { type: 'string', description: 'Why this clarification is needed' },
        options: {
          type: 'array',
          description: 'Possible answers/interpretations to choose from',
          items: { type: 'string' },
        },
      },
      required: ['question', 'context'],
    },
  },
];

/**
 * PM (Project Manager / Orchestrator) Agent
 *
 * Responsibilities:
 * - Task decomposition: Break complex tasks into actionable subtasks
 * - Agent assignment: Determine which agent handles each subtask based on strengths
 * - Progress monitoring: Track subtask completion and dependencies
 * - Escalation handling: Surface blockers and risks to stakeholders
 */
export class PMAgent extends BaseAgent {
  private llm: LLMClient;

  constructor(agentId: string = 'agent:pm') {
    super(agentId, 'pm', 'pm');
    this.llm = new LLMClient();
  }

  getCapabilities() {
    return [
      { id: 'skill:orchestration', version: '1.0', tags: ['planning', 'coordination'] },
      { id: 'skill:task-decomposition', version: '1.0', tags: ['planning'] },
      { id: 'skill:agent-assignment', version: '1.0', tags: ['routing'] },
      { id: 'skill:progress-monitoring', version: '1.0', tags: ['tracking'] },
    ];
  }

  getAvailableActions() {
    return [
      'plan',           // Create execution plan for a task
      'decompose',      // Break task into subtasks
      'assign',         // Assign subtask to an agent
      'review_progress', // Review progress of subtasks
      'escalate',       // Escalate a blocker
      'summarize',      // Summarize status for stakeholders
    ];
  }

  protected async executeTask(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const action = dispatch.action || 'plan';

    switch (action) {
      case 'plan':
      case 'decompose':
        return this.decomposeTask(dispatch, context);

      case 'review_progress':
        return this.reviewProgress(dispatch, context);

      case 'summarize':
        return this.summarizeStatus(dispatch, context);

      default:
        return this.decomposeTask(dispatch, context);
    }
  }

  /**
   * Decompose a task into subtasks with agent assignments
   */
  private async decomposeTask(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const title = dispatch.input.title as string || 'Untitled Task';
    const description = dispatch.input.description as string || '';
    const requirements = dispatch.input.requirements as string[] || [];

    context.reportProgress(10, 'Analyzing task requirements');

    // Build system prompt with PM personality and operating rules
    const systemPrompt = this.buildSystemPrompt(context);

    // Build user prompt with task details
    const userPrompt = this.buildDecompositionPrompt(title, description, requirements);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    // Include working memory if available
    if (context.workingMemory) {
      messages.push({
        role: 'user',
        content: `Previous context from working memory:\n${context.workingMemory}`,
      });
    }

    context.reportProgress(30, 'Planning task decomposition');

    try {
      // Call LLM with tools
      const response = await this.llm.completeWithTools(messages, PM_TOOLS, {
        maxTokens: 2000,
        temperature: 0.3, // Lower temperature for more consistent planning
      });

      context.emitToolCall('llm.complete', { messages, tools: PM_TOOLS }, response);

      context.reportProgress(70, 'Processing decomposition result');

      // Extract decomposition from tool calls or text
      let decomposition: DecompositionResult | null = null;

      if (response.toolCalls?.length) {
        const decomposeCall = response.toolCalls.find(tc => tc.name === 'decompose_task');
        if (decomposeCall) {
          decomposition = decomposeCall.arguments as unknown as DecompositionResult;
        }
      }

      // If no tool call, try to parse from text
      if (!decomposition) {
        decomposition = this.parseDecompositionFromText(response.content);
      }

      if (!decomposition || !decomposition.subtasks.length) {
        return {
          success: false,
          error: {
            code: 'NO_DECOMPOSITION',
            message: 'Failed to decompose task into subtasks',
            retryable: true,
          },
          usage: {
            tokens: response.usage.totalTokens,
            cost: response.cost,
          },
        };
      }

      context.reportProgress(90, 'Finalizing plan');

      // Build output
      const output = {
        type: 'plan',
        summary: decomposition.summary,
        subtasks: decomposition.subtasks,
        timeline: decomposition.timeline,
        risks: decomposition.risks,
        assumptions: decomposition.assumptions,
        metadata: {
          taskTitle: title,
          totalSubtasks: decomposition.subtasks.length,
          agentAssignments: this.countAssignments(decomposition.subtasks),
        },
      };

      return {
        success: true,
        output,
        subtasks: decomposition.subtasks.map(st => ({
          title: st.title,
          description: st.description,
          assignTo: st.assignTo,
          priority: st.priority,
          requires: this.getRequiredCapabilities(st.assignTo),
        })),
        memoryUpdates: {
          workingNotes: `Decomposed "${title}" into ${decomposition.subtasks.length} subtasks`,
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Task decomposition failed');
      return {
        success: false,
        error: {
          code: 'DECOMPOSITION_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Review progress of subtasks
   */
  private async reviewProgress(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const subtaskStatuses = dispatch.input.subtaskStatuses as Array<{
      taskId: string;
      title: string;
      state: string;
      assignee: string;
      completedAt?: string;
      error?: string;
    }> || [];

    context.reportProgress(20, 'Analyzing subtask progress');

    // Calculate overall progress
    const completed = subtaskStatuses.filter(s => s.state === 'done').length;
    const failed = subtaskStatuses.filter(s => s.state === 'failed').length;
    const inProgress = subtaskStatuses.filter(s => s.state === 'running').length;
    const pending = subtaskStatuses.filter(s => ['created', 'assigned'].includes(s.state)).length;
    const total = subtaskStatuses.length;

    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Check for blockers
    const blockers = subtaskStatuses
      .filter(s => s.state === 'failed')
      .map(s => ({
        taskTitle: s.title,
        assignee: s.assignee,
        error: s.error || 'Unknown error',
      }));

    context.reportProgress(80, 'Generating progress summary');

    const output = {
      type: 'progress_report',
      summary: {
        total,
        completed,
        inProgress,
        pending,
        failed,
        progressPercent,
      },
      blockers,
      recommendations: this.generateRecommendations(subtaskStatuses),
      nextActions: this.determineNextActions(subtaskStatuses),
    };

    return {
      success: true,
      output,
      memoryUpdates: {
        workingNotes: `Progress: ${progressPercent}% (${completed}/${total} complete, ${failed} failed)`,
      },
      usage: { tokens: 0, cost: 0 },
    };
  }

  /**
   * Summarize status for stakeholders
   */
  private async summarizeStatus(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const taskTitle = dispatch.input.taskTitle as string || 'Task';
    const subtaskStatuses = dispatch.input.subtaskStatuses as Array<{
      title: string;
      state: string;
      assignee: string;
    }> || [];
    const artifacts = dispatch.input.artifacts as string[] || [];

    context.reportProgress(30, 'Generating stakeholder summary');

    const systemPrompt = `You are a project manager creating a status summary for stakeholders.
Be concise, highlight key accomplishments and blockers, and focus on business impact.
Write in a professional but accessible tone.`;

    const userPrompt = `Create a status summary for the following task:

Task: ${taskTitle}

Subtask Status:
${subtaskStatuses.map(s => `- ${s.title}: ${s.state} (${s.assignee})`).join('\n')}

Artifacts Produced: ${artifacts.length > 0 ? artifacts.join(', ') : 'None yet'}

Please provide:
1. One-sentence executive summary
2. Key accomplishments (bullet points)
3. Blockers or risks (if any)
4. Next steps`;

    try {
      const response = await this.llm.complete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { maxTokens: 500, temperature: 0.5 }
      );

      context.emitToolCall('llm.complete', { messages: [systemPrompt, userPrompt] }, response);

      return {
        success: true,
        output: {
          type: 'status_summary',
          content: response.content,
          metadata: {
            taskTitle,
            subtaskCount: subtaskStatuses.length,
            artifactCount: artifacts.length,
          },
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Status summary failed');
      return {
        success: false,
        error: {
          code: 'SUMMARY_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Build system prompt based on PM personality and rules
   */
  private buildSystemPrompt(context: AgentContext): string {
    const personality = context.personality || {};
    const rules = context.operatingRules || [];

    let prompt = `You are a Project Manager agent responsible for orchestrating tasks and coordinating other agents.

Your communication style is ${personality.communication || 'concise'} and your approach is ${personality.style || 'systematic'}.
You make decisions in a ${personality.decision_making || 'decisive'} manner.

Available agents to assign work to:
- agent:research - Gathers information, performs market analysis, competitive intelligence
- agent:marketing - Creates copy, landing page content, marketing materials
- agent:developer - Writes code, handles git operations, implements features
- agent:qa - Tests work, validates quality, identifies issues

When decomposing tasks:
1. Break complex tasks into actionable subtasks with clear deliverables
2. Assign each subtask to the most appropriate agent based on their strengths
3. Consider dependencies between subtasks for proper sequencing
4. Prioritize based on business impact, not complexity
5. Identify potential blockers early`;

    if (rules.length > 0) {
      prompt += `\n\nOperating Rules (MUST follow):`;
      rules.forEach((rule, i) => {
        prompt += `\n${i + 1}. ${rule}`;
      });
    }

    if (context.longTermMemory) {
      prompt += `\n\nRelevant knowledge from memory:\n${context.longTermMemory}`;
    }

    return prompt;
  }

  /**
   * Build prompt for task decomposition
   */
  private buildDecompositionPrompt(
    title: string,
    description: string,
    requirements: string[]
  ): string {
    let prompt = `Please decompose the following task into subtasks:

Task: ${title}
${description ? `Description: ${description}` : ''}`;

    if (requirements.length > 0) {
      prompt += `\n\nRequirements:\n${requirements.map(r => `- ${r}`).join('\n')}`;
    }

    prompt += `

Use the decompose_task tool to output your plan. Consider:
1. What research is needed first?
2. What content/copy needs to be created?
3. What code needs to be written?
4. What needs to be tested/validated?
5. What are the dependencies between subtasks?`;

    return prompt;
  }

  /**
   * Parse decomposition from text if tool call wasn't used
   */
  private parseDecompositionFromText(text: string): DecompositionResult | null {
    // Simple heuristic parsing - look for numbered lists or bullet points
    const lines = text.split('\n').filter(l => l.trim());
    const subtasks: Subtask[] = [];

    let currentSubtask: Partial<Subtask> | null = null;

    for (const line of lines) {
      // Check for subtask headers (numbered or bulleted)
      const match = line.match(/^[\d\-\*\•]\s*(?:\.|:)?\s*(.+)/);
      if (match) {
        if (currentSubtask && currentSubtask.title) {
          subtasks.push({
            title: currentSubtask.title,
            description: currentSubtask.description || currentSubtask.title,
            assignTo: currentSubtask.assignTo || this.inferAgent(currentSubtask.title),
            priority: currentSubtask.priority || 'medium',
          });
        }
        currentSubtask = { title: match[1]!.trim() };
      } else if (currentSubtask) {
        // Add to description
        currentSubtask.description = (currentSubtask.description || '') + ' ' + line.trim();

        // Try to infer agent from keywords
        if (!currentSubtask.assignTo) {
          currentSubtask.assignTo = this.inferAgent(line);
        }
      }
    }

    // Add last subtask
    if (currentSubtask && currentSubtask.title) {
      subtasks.push({
        title: currentSubtask.title,
        description: currentSubtask.description || currentSubtask.title,
        assignTo: currentSubtask.assignTo || 'agent:developer',
        priority: currentSubtask.priority || 'medium',
      });
    }

    if (subtasks.length === 0) {
      return null;
    }

    return {
      summary: `Decomposed into ${subtasks.length} subtasks`,
      subtasks,
    };
  }

  /**
   * Infer agent from task text
   */
  private inferAgent(text: string): string {
    const lower = text.toLowerCase();

    if (lower.includes('research') || lower.includes('analyze') || lower.includes('investigate')) {
      return 'agent:research';
    }
    if (lower.includes('copy') || lower.includes('content') || lower.includes('marketing') || lower.includes('landing')) {
      return 'agent:marketing';
    }
    if (lower.includes('test') || lower.includes('qa') || lower.includes('validate') || lower.includes('verify')) {
      return 'agent:qa';
    }
    if (lower.includes('code') || lower.includes('implement') || lower.includes('develop') || lower.includes('build')) {
      return 'agent:developer';
    }

    return 'agent:developer'; // Default
  }

  /**
   * Get required capabilities based on agent
   */
  private getRequiredCapabilities(agentId: string): string[] {
    const capMap: Record<string, string[]> = {
      'agent:research': ['skill:research'],
      'agent:marketing': ['skill:copywriting'],
      'agent:developer': ['skill:coding'],
      'agent:qa': ['skill:testing'],
    };
    return capMap[agentId] || [];
  }

  /**
   * Count assignments per agent
   */
  private countAssignments(subtasks: Subtask[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const st of subtasks) {
      counts[st.assignTo] = (counts[st.assignTo] || 0) + 1;
    }
    return counts;
  }

  /**
   * Generate recommendations based on progress
   */
  private generateRecommendations(
    statuses: Array<{ state: string; assignee: string; error?: string }>
  ): string[] {
    const recommendations: string[] = [];

    const failedCount = statuses.filter(s => s.state === 'failed').length;
    if (failedCount > 0) {
      recommendations.push(`Review ${failedCount} failed subtask(s) and determine if retry or escalation is needed`);
    }

    const stuckCount = statuses.filter(s => s.state === 'running').length;
    if (stuckCount > 3) {
      recommendations.push(`${stuckCount} subtasks running in parallel - monitor for resource contention`);
    }

    return recommendations;
  }

  /**
   * Determine next actions based on status
   */
  private determineNextActions(
    statuses: Array<{ title: string; state: string }>
  ): string[] {
    const pending = statuses.filter(s => ['created', 'assigned'].includes(s.state));
    if (pending.length > 0) {
      return [`Start next pending subtask: "${pending[0]!.title}"`];
    }

    const allDone = statuses.every(s => s.state === 'done');
    if (allDone) {
      return ['All subtasks complete - ready for final review'];
    }

    return ['Continue monitoring in-progress subtasks'];
  }
}

// Export singleton
export const pmAgent = new PMAgent();
