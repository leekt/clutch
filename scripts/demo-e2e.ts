#!/usr/bin/env bun
/**
 * E2E Demo Script
 *
 * Demonstrates the full Clutch workflow:
 * 1. Creates a run with the product-development workflow
 * 2. Monitors workflow progress
 * 3. Shows review chain in action
 *
 * Usage:
 *   make demo
 *   # or: bun run scripts/demo-e2e.ts
 *
 * Prerequisites:
 *   - clutchd running: make dev (or bun run --filter clutchd dev)
 *   - Database migrated: make db-migrate
 *   - Database seeded: make db-seed
 *   - OPENAI_API_KEY or ANTHROPIC_API_KEY set
 */

const API_BASE = process.env.CLUTCH_API_URL || 'http://localhost:3001';

interface RunResponse {
  runId: string;
  taskId: string;
  threadId: string;
  messageId: string;
}

interface RunStatus {
  runId: string;
  status: string;
  tasks: Array<{
    taskId: string;
    title: string;
    state: string;
    workflowStepId?: string;
  }>;
  summary: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
  };
}

interface WorkflowStatus {
  execution: {
    workflowId: string;
    workflowName: string;
    currentStepId: string;
    taskId: string;
    runId: string;
    reworkCount: number;
  };
  workflow: {
    name: string;
    description: string;
  };
  currentStep: {
    id: string;
    name: string;
    agent: string;
    action: string;
    requires_review: boolean;
    reviewer?: string;
  };
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`API Error: ${error.error || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function createRun(title: string, description: string, workflowName: string): Promise<RunResponse> {
  console.log(`\n📋 Creating run: "${title}"`);
  console.log(`   Workflow: ${workflowName}`);

  const result = await api<RunResponse>('/api/runs', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description,
      workflowName,
    }),
  });

  console.log(`   ✅ Run created: ${result.runId}`);
  console.log(`   Task ID: ${result.taskId}`);
  return result;
}

async function getRunStatus(runId: string): Promise<RunStatus> {
  return api<RunStatus>(`/api/runs/${runId}`);
}

async function getWorkflowStatus(taskId: string): Promise<WorkflowStatus | null> {
  try {
    return await api<WorkflowStatus>(`/api/tasks/${taskId}/workflow/status`);
  } catch {
    return null;
  }
}

async function advanceWorkflow(taskId: string, decision: 'approved' | 'rejected', comments?: string): Promise<void> {
  console.log(`\n${decision === 'approved' ? '✅' : '❌'} ${decision.toUpperCase()}: ${comments || ''}`);

  await api(`/api/tasks/${taskId}/workflow/advance`, {
    method: 'POST',
    body: JSON.stringify({ decision, comments }),
  });
}

function formatState(state: string): string {
  const icons: Record<string, string> = {
    created: '⬜',
    assigned: '📋',
    running: '🔄',
    review: '👀',
    rework: '↩️',
    done: '✅',
    failed: '❌',
    cancelled: '🚫',
  };
  return `${icons[state] || '?'} ${state}`;
}

async function monitorRun(runId: string, taskId: string, autoApprove: boolean = false): Promise<void> {
  console.log('\n📊 Monitoring workflow progress...\n');
  console.log('─'.repeat(60));

  let lastStepId = '';
  let iterations = 0;
  const maxIterations = 60; // 5 minutes with 5s intervals

  while (iterations < maxIterations) {
    const status = await getRunStatus(runId);
    const workflow = await getWorkflowStatus(taskId);

    // Show status summary
    console.log(`\n⏱️  Status: ${status.status.toUpperCase()}`);
    console.log(`   Tasks: ${status.summary.completed}/${status.summary.total} completed`);

    if (status.summary.running > 0) {
      console.log(`   Running: ${status.summary.running}`);
    }
    if (status.summary.failed > 0) {
      console.log(`   Failed: ${status.summary.failed}`);
    }

    // Show workflow step
    if (workflow) {
      const step = workflow.currentStep;

      if (step.id !== lastStepId) {
        console.log('\n' + '─'.repeat(60));
        console.log(`📍 Current Step: ${step.name}`);
        console.log(`   Agent: ${step.agent}`);
        console.log(`   Action: ${step.action}`);
        if (step.requires_review) {
          console.log(`   Reviewer: ${step.reviewer || 'pm'}`);
        }
        lastStepId = step.id;
      }

      // Check if awaiting review
      const task = status.tasks.find(t => t.taskId === taskId);
      if (task?.state === 'review') {
        console.log('\n👀 Awaiting review...');

        if (autoApprove) {
          console.log('   Auto-approving (demo mode)...');
          await advanceWorkflow(taskId, 'approved', 'Auto-approved by demo script');
        } else {
          // In interactive mode, would prompt user
          console.log('   Run with --auto-approve to automatically approve');
          console.log('   Or use the API: POST /api/tasks/:id/workflow/advance');

          // For now, auto-approve after a delay
          console.log('   Auto-approving in 3 seconds...');
          await sleep(3000);
          await advanceWorkflow(taskId, 'approved', 'Demo auto-approval');
        }
      }
    }

    // Check for completion
    if (status.status === 'completed') {
      console.log('\n' + '═'.repeat(60));
      console.log('🎉 WORKFLOW COMPLETED SUCCESSFULLY!');
      console.log('═'.repeat(60));

      // Show final task states
      console.log('\nFinal task states:');
      for (const task of status.tasks) {
        console.log(`   ${formatState(task.state)} ${task.title || task.taskId}`);
      }
      return;
    }

    if (status.status === 'failed') {
      console.log('\n' + '═'.repeat(60));
      console.log('❌ WORKFLOW FAILED');
      console.log('═'.repeat(60));
      return;
    }

    await sleep(5000);
    iterations++;
  }

  console.log('\n⚠️  Monitoring timeout - workflow still running');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function listWorkflows(): Promise<void> {
  console.log('\n📋 Available Workflows:\n');

  const { workflows } = await api<{ workflows: Array<{ name: string; description: string }> }>('/api/workflows');

  for (const workflow of workflows) {
    console.log(`   • ${workflow.name}`);
    console.log(`     ${workflow.description}`);
    console.log();
  }
}

async function checkHealth(): Promise<boolean> {
  try {
    const result = await api<{ status: string }>('/health');
    return result.status === 'ok';
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('        CLUTCH E2E DEMO - Agent Organization OS');
  console.log('═'.repeat(60));

  // Check if clutchd is running
  console.log('\n🔍 Checking clutchd connection...');
  const healthy = await checkHealth();
  if (!healthy) {
    console.error('❌ Cannot connect to clutchd at', API_BASE);
    console.error('   Make sure clutchd is running: make dev');
    process.exit(1);
  }
  console.log('✅ Connected to clutchd');

  // List available workflows
  await listWorkflows();

  // Parse command line args
  const args = process.argv.slice(2);
  const autoApprove = args.includes('--auto-approve');
  const workflowName = args.find(a => !a.startsWith('--')) || 'product-development';

  // Create a demo run
  const title = 'AI-powered Task Management SaaS';
  const description = `
    Research the market for AI-powered task management tools.
    Create compelling marketing copy for a landing page.
    Implement a basic prototype with React and TypeScript.
  `.trim();

  try {
    const run = await createRun(title, description, workflowName);

    // Monitor the workflow
    await monitorRun(run.runId, run.taskId, autoApprove);
  } catch (error) {
    console.error('\n❌ Error:', (error as Error).message);
    process.exit(1);
  }
}

main();
