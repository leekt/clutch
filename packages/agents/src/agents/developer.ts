import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

import pino from 'pino';

import { BaseAgent, type AgentContext, type ExecutionResult, type TaskDispatch } from '../executor/base-agent.js';
import { LLMClient, type LLMMessage, type ToolDefinition } from '../executor/llm-client.js';

const execFileAsync = promisify(execFile);
const logger = pino({ name: 'agent-developer' });

/**
 * File change representation
 */
interface FileChange {
  path: string;
  action: 'create' | 'modify' | 'delete';
  content?: string;
  diff?: string;
}

/**
 * Code generation result
 */
interface CodeOutput {
  files: FileChange[];
  summary: string;
  testFiles?: FileChange[];
  documentation?: string;
}

/**
 * Developer Agent Tools
 */
const DEVELOPER_TOOLS: ToolDefinition[] = [
  {
    name: 'write_code',
    description: 'Generate code files with content',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'List of files to create/modify',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path relative to workspace' },
              action: {
                type: 'string',
                description: 'Action to perform',
                enum: ['create', 'modify', 'delete'],
              },
              content: { type: 'string', description: 'Full file content (for create/modify)' },
              description: { type: 'string', description: 'Description of changes' },
            },
            required: ['path', 'action'],
          },
        },
        summary: {
          type: 'string',
          description: 'Summary of all changes made',
        },
        testStrategy: {
          type: 'string',
          description: 'How to test these changes',
        },
      },
      required: ['files', 'summary'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command (with permission)',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
        args: {
          type: 'array',
          description: 'Command arguments',
          items: { type: 'string' },
        },
        cwd: { type: 'string', description: 'Working directory' },
        reason: { type: 'string', description: 'Why this command is needed' },
      },
      required: ['command', 'reason'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'git_operation',
    description: 'Perform git operations',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'Git operation to perform',
          enum: ['status', 'diff', 'add', 'commit', 'branch', 'checkout'],
        },
        args: {
          type: 'array',
          description: 'Arguments for the operation',
          items: { type: 'string' },
        },
        message: { type: 'string', description: 'Commit message (for commit)' },
      },
      required: ['operation'],
    },
  },
  {
    name: 'request_review',
    description: 'Mark code as ready for review',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'Files to include in review',
          items: { type: 'string' },
        },
        summary: { type: 'string', description: 'Summary of changes' },
        testsPassing: { type: 'boolean', description: 'Whether tests are passing' },
        notes: { type: 'string', description: 'Notes for reviewer' },
      },
      required: ['files', 'summary'],
    },
  },
];

/**
 * Developer Agent
 *
 * Responsibilities:
 * - Code generation: Create and modify code files
 * - File operations: Read, write, delete files in workspace
 * - Git operations: Branch, commit, status
 * - Code review response: Address review feedback
 */
export class DeveloperAgent extends BaseAgent {
  private llm: LLMClient;
  private workspaceRoot: string;
  private allowShell: boolean;
  private allowGit: boolean;

  constructor(
    agentId: string = 'agent:developer',
    options: {
      workspaceRoot?: string;
      allowShell?: boolean;
      allowGit?: boolean;
    } = {}
  ) {
    super(agentId, 'developer', 'developer');
    this.llm = new LLMClient();
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.allowShell = options.allowShell ?? false;
    this.allowGit = options.allowGit ?? false;
  }

  getCapabilities() {
    return [
      { id: 'skill:coding', version: '1.0', tags: ['implementation'] },
      { id: 'skill:typescript', version: '1.0', tags: ['language'] },
      { id: 'skill:react', version: '1.0', tags: ['framework'] },
      { id: 'skill:nodejs', version: '1.0', tags: ['runtime'] },
      { id: 'skill:git', version: '1.0', tags: ['vcs'] },
    ];
  }

  getAvailableActions() {
    return [
      'implement',       // Implement a feature
      'fix',            // Fix a bug
      'refactor',       // Refactor code
      'test',           // Write tests
      'review_response', // Respond to code review
      'document',       // Write documentation
    ];
  }

  protected async executeTask(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const action = dispatch.action || 'implement';

    switch (action) {
      case 'implement':
        return this.implementFeature(dispatch, context);

      case 'fix':
        return this.fixBug(dispatch, context);

      case 'refactor':
        return this.refactorCode(dispatch, context);

      case 'test':
        return this.writeTests(dispatch, context);

      case 'review_response':
        return this.respondToReview(dispatch, context);

      case 'document':
        return this.writeDocumentation(dispatch, context);

      default:
        return this.implementFeature(dispatch, context);
    }
  }

  /**
   * Implement a feature
   */
  private async implementFeature(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const feature = dispatch.input.feature as string || dispatch.input.title as string || '';
    const requirements = dispatch.input.requirements as string[] || [];
    const existingFiles = dispatch.input.existingFiles as string[] || [];
    const codeContext = dispatch.input.codeContext as string || '';
    const framework = dispatch.input.framework as string || 'typescript';

    if (!feature) {
      return {
        success: false,
        error: {
          code: 'MISSING_FEATURE',
          message: 'Feature description is required',
          retryable: false,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }

    context.reportProgress(5, 'Analyzing requirements');

    // Read existing files if provided
    let existingCode = '';
    if (existingFiles.length > 0) {
      context.reportProgress(15, 'Reading existing code');
      existingCode = await this.readExistingFiles(existingFiles);
    }

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(context, framework);

    // Build implementation prompt
    const userPrompt = this.buildImplementationPrompt(feature, requirements, existingCode, codeContext);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    // Add working memory
    if (context.workingMemory) {
      messages.push({
        role: 'user',
        content: `Previous work context:\n${context.workingMemory}`,
      });
    }

    context.reportProgress(30, 'Generating implementation');

    try {
      const response = await this.llm.completeWithTools(messages, DEVELOPER_TOOLS, {
        maxTokens: 4000,
        temperature: 0.2, // Lower temperature for more consistent code
      });

      context.emitToolCall('llm.complete', { feature, framework }, response);

      context.reportProgress(70, 'Processing generated code');

      // Extract code output
      let output: CodeOutput | null = null;

      if (response.toolCalls?.length) {
        const codeCall = response.toolCalls.find(tc => tc.name === 'write_code');
        if (codeCall) {
          output = {
            files: codeCall.arguments.files as FileChange[],
            summary: codeCall.arguments.summary as string,
          };
        }
      }

      // Fallback: parse from text
      if (!output) {
        output = this.parseCodeFromText(response.content);
      }

      if (!output || !output.files?.length) {
        return {
          success: false,
          error: {
            code: 'NO_CODE_GENERATED',
            message: 'Failed to generate code',
            retryable: true,
          },
          usage: {
            tokens: response.usage.totalTokens,
            cost: response.cost,
          },
        };
      }

      context.reportProgress(85, 'Writing files');

      // Write files to workspace (if we have permission)
      const writtenFiles = await this.writeFiles(output.files, context);

      context.reportProgress(95, 'Finalizing');

      return {
        success: true,
        output: {
          type: 'implementation',
          feature,
          ...output,
          writtenFiles,
          metadata: {
            fileCount: output.files.length,
            framework,
          },
        },
        artifacts: writtenFiles.map(f => ({
          path: f,
          hash: '', // Would compute actual hash
          mimeType: 'text/plain',
        })),
        memoryUpdates: {
          workingNotes: `Implemented "${feature}" with ${output.files.length} files`,
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Implementation failed');
      return {
        success: false,
        error: {
          code: 'IMPLEMENTATION_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Fix a bug
   */
  private async fixBug(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const bug = dispatch.input.bug as string || dispatch.input.title as string || '';
    const errorMessage = dispatch.input.errorMessage as string || '';
    const stackTrace = dispatch.input.stackTrace as string || '';
    const affectedFiles = dispatch.input.affectedFiles as string[] || [];

    if (!bug) {
      return {
        success: false,
        error: {
          code: 'MISSING_BUG',
          message: 'Bug description is required',
          retryable: false,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }

    context.reportProgress(10, 'Analyzing bug');

    // Read affected files
    let existingCode = '';
    if (affectedFiles.length > 0) {
      existingCode = await this.readExistingFiles(affectedFiles);
    }

    const systemPrompt = this.buildSystemPrompt(context, 'typescript') + `

When fixing bugs:
1. Identify the root cause, not just symptoms
2. Make minimal changes to fix the issue
3. Add tests to prevent regression
4. Document the fix`;

    const userPrompt = `Fix the following bug:

Bug Description: ${bug}
${errorMessage ? `Error Message: ${errorMessage}` : ''}
${stackTrace ? `Stack Trace:\n${stackTrace}` : ''}

${existingCode ? `Affected Code:\n${existingCode}` : ''}

Analyze the bug, identify the root cause, and provide a fix using the write_code tool.`;

    context.reportProgress(30, 'Generating fix');

    try {
      const response = await this.llm.completeWithTools(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        DEVELOPER_TOOLS,
        { maxTokens: 3000, temperature: 0.1 }
      );

      context.reportProgress(70, 'Processing fix');

      let output: CodeOutput | null = null;

      if (response.toolCalls?.length) {
        const codeCall = response.toolCalls.find(tc => tc.name === 'write_code');
        if (codeCall) {
          output = {
            files: codeCall.arguments.files as FileChange[],
            summary: codeCall.arguments.summary as string,
          };
        }
      }

      if (!output) {
        output = this.parseCodeFromText(response.content);
      }

      const writtenFiles = output ? await this.writeFiles(output.files, context) : [];

      return {
        success: true,
        output: {
          type: 'bug_fix',
          bug,
          ...output,
          analysis: response.content.slice(0, 500),
          writtenFiles,
        },
        memoryUpdates: {
          workingNotes: `Fixed bug: "${bug}"`,
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'FIX_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Refactor code
   */
  private async refactorCode(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const target = dispatch.input.target as string || '';
    const goal = dispatch.input.goal as string || 'improve maintainability';
    const files = dispatch.input.files as string[] || [];

    if (!target && files.length === 0) {
      return {
        success: false,
        error: {
          code: 'MISSING_TARGET',
          message: 'Refactoring target or files required',
          retryable: false,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }

    context.reportProgress(10, 'Analyzing code for refactoring');

    const existingCode = await this.readExistingFiles(files);

    const systemPrompt = this.buildSystemPrompt(context, 'typescript') + `

When refactoring:
1. Preserve existing behavior exactly
2. Improve code quality incrementally
3. Follow existing patterns and conventions
4. Break large changes into smaller steps`;

    const userPrompt = `Refactor the following code:

Target: ${target}
Goal: ${goal}

${existingCode ? `Current Code:\n${existingCode}` : ''}

Provide the refactored code using the write_code tool. Ensure behavior is preserved.`;

    context.reportProgress(30, 'Generating refactored code');

    try {
      const response = await this.llm.completeWithTools(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        DEVELOPER_TOOLS,
        { maxTokens: 4000, temperature: 0.2 }
      );

      let output: CodeOutput | null = null;

      if (response.toolCalls?.length) {
        const codeCall = response.toolCalls.find(tc => tc.name === 'write_code');
        if (codeCall) {
          output = {
            files: codeCall.arguments.files as FileChange[],
            summary: codeCall.arguments.summary as string,
          };
        }
      }

      const writtenFiles = output ? await this.writeFiles(output.files, context) : [];

      return {
        success: true,
        output: {
          type: 'refactor',
          target,
          goal,
          ...output,
          writtenFiles,
        },
        memoryUpdates: {
          workingNotes: `Refactored: ${target} (${goal})`,
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'REFACTOR_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Write tests
   */
  private async writeTests(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const target = dispatch.input.target as string || '';
    const files = dispatch.input.files as string[] || [];
    const testFramework = dispatch.input.testFramework as string || 'vitest';

    if (!target && files.length === 0) {
      return {
        success: false,
        error: {
          code: 'MISSING_TARGET',
          message: 'Test target or source files required',
          retryable: false,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }

    context.reportProgress(10, 'Analyzing code for test coverage');

    const sourceCode = await this.readExistingFiles(files);

    const systemPrompt = this.buildSystemPrompt(context, 'typescript') + `

When writing tests:
1. Test behavior, not implementation
2. Cover edge cases and error conditions
3. Use descriptive test names
4. Keep tests focused and independent
5. Use ${testFramework} conventions`;

    const userPrompt = `Write tests for:

Target: ${target}
Test Framework: ${testFramework}

${sourceCode ? `Source Code:\n${sourceCode}` : ''}

Generate comprehensive tests using the write_code tool. Include:
- Happy path tests
- Edge cases
- Error handling
- Any integration tests needed`;

    context.reportProgress(30, 'Generating tests');

    try {
      const response = await this.llm.completeWithTools(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        DEVELOPER_TOOLS,
        { maxTokens: 3000, temperature: 0.3 }
      );

      let output: CodeOutput | null = null;

      if (response.toolCalls?.length) {
        const codeCall = response.toolCalls.find(tc => tc.name === 'write_code');
        if (codeCall) {
          output = {
            files: codeCall.arguments.files as FileChange[],
            summary: codeCall.arguments.summary as string,
          };
        }
      }

      const writtenFiles = output ? await this.writeFiles(output.files, context) : [];

      return {
        success: true,
        output: {
          type: 'tests',
          target,
          testFramework,
          ...output,
          writtenFiles,
        },
        memoryUpdates: {
          workingNotes: `Wrote tests for: ${target}`,
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'TEST_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Respond to code review feedback
   */
  private async respondToReview(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const feedback = dispatch.input.feedback as Array<{
      file: string;
      line?: number;
      comment: string;
      severity: 'critical' | 'suggestion' | 'nitpick';
    }> || [];
    const files = dispatch.input.files as string[] || [];

    if (feedback.length === 0) {
      return {
        success: false,
        error: {
          code: 'NO_FEEDBACK',
          message: 'Review feedback is required',
          retryable: false,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }

    context.reportProgress(10, 'Analyzing review feedback');

    const sourceCode = await this.readExistingFiles(files);

    const systemPrompt = this.buildSystemPrompt(context, 'typescript') + `

When responding to code review:
1. Address all critical issues first
2. Implement suggestions that improve code quality
3. Explain reasoning if you disagree with a comment
4. Ask for clarification if needed`;

    const feedbackText = feedback.map(f =>
      `[${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''}: ${f.comment}`
    ).join('\n');

    const userPrompt = `Address the following code review feedback:

${feedbackText}

${sourceCode ? `Current Code:\n${sourceCode}` : ''}

Use the write_code tool to implement fixes for all issues.`;

    context.reportProgress(30, 'Addressing feedback');

    try {
      const response = await this.llm.completeWithTools(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        DEVELOPER_TOOLS,
        { maxTokens: 3500, temperature: 0.2 }
      );

      let output: CodeOutput | null = null;

      if (response.toolCalls?.length) {
        const codeCall = response.toolCalls.find(tc => tc.name === 'write_code');
        if (codeCall) {
          output = {
            files: codeCall.arguments.files as FileChange[],
            summary: codeCall.arguments.summary as string,
          };
        }
      }

      const writtenFiles = output ? await this.writeFiles(output.files, context) : [];

      return {
        success: true,
        output: {
          type: 'review_response',
          feedbackCount: feedback.length,
          addressedCount: output?.files.length || 0,
          ...output,
          writtenFiles,
        },
        memoryUpdates: {
          workingNotes: `Addressed ${feedback.length} review comments`,
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'REVIEW_RESPONSE_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Write documentation
   */
  private async writeDocumentation(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const target = dispatch.input.target as string || '';
    const docType = dispatch.input.docType as 'readme' | 'api' | 'inline' || 'readme';
    const files = dispatch.input.files as string[] || [];

    context.reportProgress(10, 'Analyzing code for documentation');

    const sourceCode = await this.readExistingFiles(files);

    const docTypeInstructions = {
      readme: 'Create a comprehensive README with usage examples, installation, and API reference',
      api: 'Generate API documentation with types, parameters, return values, and examples',
      inline: 'Add JSDoc/TSDoc comments to functions, classes, and types',
    };

    const systemPrompt = this.buildSystemPrompt(context, 'typescript') + `

When writing documentation:
1. Be clear and concise
2. Include practical examples
3. Document edge cases and limitations
4. Keep it up-to-date with code`;

    const userPrompt = `Write documentation for:

Target: ${target}
Documentation Type: ${docType}
Instructions: ${docTypeInstructions[docType]}

${sourceCode ? `Source Code:\n${sourceCode}` : ''}

Use the write_code tool to create documentation files or add inline docs.`;

    context.reportProgress(30, 'Generating documentation');

    try {
      const response = await this.llm.completeWithTools(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        DEVELOPER_TOOLS,
        { maxTokens: 3000, temperature: 0.4 }
      );

      let output: CodeOutput | null = null;

      if (response.toolCalls?.length) {
        const codeCall = response.toolCalls.find(tc => tc.name === 'write_code');
        if (codeCall) {
          output = {
            files: codeCall.arguments.files as FileChange[],
            summary: codeCall.arguments.summary as string,
            documentation: response.content,
          };
        }
      }

      const writtenFiles = output ? await this.writeFiles(output.files, context) : [];

      return {
        success: true,
        output: {
          type: 'documentation',
          target,
          docType,
          ...output,
          writtenFiles,
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'DOC_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Build system prompt
   */
  private buildSystemPrompt(context: AgentContext, framework: string): string {
    const personality = context.personality || {};
    const rules = context.operatingRules || [];

    let prompt = `You are a Developer Agent writing ${framework} code.

Your approach is ${personality.style || 'pragmatic'} with ${personality.communication || 'concise'} communication.
You make decisions based on ${personality.decision_making || 'data-driven'} analysis.

Core principles:
1. Write clean, maintainable code
2. Follow existing patterns and conventions
3. Include appropriate error handling
4. Write tests for new functionality
5. Document public APIs`;

    if (rules.length > 0) {
      prompt += `\n\nOperating Rules (MUST follow):`;
      rules.forEach((rule, i) => {
        prompt += `\n${i + 1}. ${rule}`;
      });
    }

    return prompt;
  }

  /**
   * Build implementation prompt
   */
  private buildImplementationPrompt(
    feature: string,
    requirements: string[],
    existingCode: string,
    codeContext: string
  ): string {
    let prompt = `Implement the following feature:

Feature: ${feature}`;

    if (requirements.length > 0) {
      prompt += `\n\nRequirements:\n${requirements.map(r => `- ${r}`).join('\n')}`;
    }

    if (codeContext) {
      prompt += `\n\nCode Context:\n${codeContext}`;
    }

    if (existingCode) {
      prompt += `\n\nExisting Code:\n${existingCode}`;
    }

    prompt += `\n\nUse the write_code tool to provide your implementation.
Include:
1. All necessary files with full content
2. Summary of changes
3. How to test the implementation`;

    return prompt;
  }

  /**
   * Read existing files
   */
  private async readExistingFiles(files: string[]): Promise<string> {
    const contents: string[] = [];

    for (const file of files.slice(0, 5)) { // Limit to 5 files
      try {
        const fullPath = path.isAbsolute(file)
          ? file
          : path.join(this.workspaceRoot, file);

        const content = await fs.readFile(fullPath, 'utf-8');
        contents.push(`// File: ${file}\n${content.slice(0, 3000)}`); // Limit per file
      } catch (error) {
        logger.warn({ file, error }, 'Failed to read file');
      }
    }

    return contents.join('\n\n---\n\n');
  }

  /**
   * Write files to workspace
   */
  private async writeFiles(files: FileChange[], context: AgentContext): Promise<string[]> {
    const written: string[] = [];

    for (const file of files) {
      if (file.action === 'delete') {
        // Don't actually delete - just record
        logger.info({ path: file.path }, 'Would delete file');
        continue;
      }

      if (!file.content) continue;

      try {
        const fullPath = path.isAbsolute(file.path)
          ? file.path
          : path.join(this.workspaceRoot, file.path);

        // Ensure directory exists
        await fs.mkdir(path.dirname(fullPath), { recursive: true });

        // Write file
        await fs.writeFile(fullPath, file.content, 'utf-8');
        written.push(file.path);

        context.emitToolCall('write_file', { path: file.path }, { success: true });
        logger.info({ path: file.path }, 'File written');
      } catch (error) {
        logger.error({ path: file.path, error }, 'Failed to write file');
      }
    }

    return written;
  }

  /**
   * Parse code from text response
   */
  private parseCodeFromText(text: string): CodeOutput | null {
    const files: FileChange[] = [];

    // Look for code blocks with file paths
    const codeBlockRegex = /```(?:typescript|javascript|tsx|jsx|ts|js)?\s*\n(?:\/\/\s*(?:File|Path):\s*(.+)\n)?([\s\S]*?)```/g;

    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const filePath = match[1]?.trim();
      const content = match[2]?.trim();

      if (content && content.length > 10) {
        files.push({
          path: filePath || `generated-${files.length + 1}.ts`,
          action: 'create',
          content,
        });
      }
    }

    if (files.length === 0) return null;

    return {
      files,
      summary: `Generated ${files.length} file(s) from response`,
    };
  }

  /**
   * Run a shell command (with permission check)
   * Uses execFile for safety (no shell injection)
   */
  async runCommand(command: string, args: string[] = [], cwd?: string): Promise<{ stdout: string; stderr: string }> {
    if (!this.allowShell) {
      throw new Error('Shell commands not permitted');
    }

    return execFileAsync(command, args, { cwd: cwd || this.workspaceRoot });
  }

  /**
   * Run a git command (with permission check)
   * Uses execFile for safety
   */
  async gitCommand(operation: string, args: string[] = []): Promise<string> {
    if (!this.allowGit) {
      throw new Error('Git operations not permitted');
    }

    const { stdout } = await execFileAsync(
      'git',
      [operation, ...args],
      { cwd: this.workspaceRoot }
    );
    return stdout;
  }
}

// Export singleton
export const developerAgent = new DeveloperAgent();
