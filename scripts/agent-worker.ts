import { DeveloperAgent } from '../packages/agents/src/agents/developer.js';
import { MarketingAgent } from '../packages/agents/src/agents/marketing.js';
import { PMAgent } from '../packages/agents/src/agents/pm.js';
import { ResearchAgent } from '../packages/agents/src/agents/research.js';
import type { BaseAgent } from '../packages/agents/src/executor/base-agent.js';
import type { TaskDispatch } from '../packages/agents/src/types.js';

type AgentKind = 'pm' | 'research' | 'marketing' | 'developer';

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        args.set(key, value);
        i++;
      } else {
        args.set(key, 'true');
      }
    }
  }
  return args;
}

function createAgent(kind: AgentKind, agentId: string): BaseAgent {
  switch (kind) {
    case 'pm':
      return new PMAgent(agentId);
    case 'research':
      return new ResearchAgent(agentId);
    case 'marketing':
      return new MarketingAgent(agentId);
    case 'developer':
      return new DeveloperAgent(agentId, {
        workspaceRoot: process.env.WORKSPACE_ROOT || process.cwd(),
        allowShell: process.env.ALLOW_SHELL === 'true',
        allowGit: process.env.ALLOW_GIT === 'true',
      });
    default:
      throw new Error(`Unsupported agent type: ${kind}`);
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const agentKind = (args.get('agent') || 'developer') as AgentKind;
  const agentId = args.get('agent-id') || `agent:${agentKind}`;

  const inputRaw = await readStdin();
  if (!inputRaw.trim()) {
    throw new Error('No input provided to agent worker');
  }

  const input = JSON.parse(inputRaw) as {
    dispatch: TaskDispatch;
    context?: Record<string, unknown>;
  };

  const agent = createAgent(agentKind, agentId);
  const result = await agent.execute(input.dispatch, input.context ?? {});

  process.stdout.write(JSON.stringify(result));
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  const failure = {
    taskId: 'unknown',
    success: false,
    error: { code: 'WORKER_ERROR', message, retryable: false },
    usage: { cost: 0, runtime: 0, tokens: 0 },
  };
  process.stdout.write(JSON.stringify(failure));
  process.exit(1);
});
