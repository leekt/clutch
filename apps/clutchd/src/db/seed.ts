import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.js';
import { generateMessageId, generateThreadId, generateRunId, generateTaskId } from '@clutch/protocol';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://clutch:clutch@localhost:5432/clutch';

async function main() {
  console.log('Seeding database...');

  const client = postgres(DATABASE_URL);
  const db = drizzle(client, { schema });

  // Clear existing data
  await db.delete(schema.artifacts);
  await db.delete(schema.auditLogs);
  await db.delete(schema.reviews);
  await db.delete(schema.messages);
  await db.delete(schema.tasks);
  await db.delete(schema.channels);
  await db.delete(schema.agents);

  // Seed agents with Clutch Protocol compliant fields
  const agentResults = await db.insert(schema.agents).values([
    {
      agentId: 'agent:pm',
      name: 'pm',
      role: 'pm',
      description: 'Project Manager - orchestrates tasks and coordinates agents',
      version: '1.0.0',
      image: 'clutch/agent-pm:latest',
      endpoints: { clutch: 'http://localhost:3002/agents/pm' },
      capabilities: [
        { id: 'planning', version: '1.0' },
        { id: 'coordination', version: '1.0' },
      ],
      tools: ['task.create', 'task.assign', 'message.send'],
      permissions: { file: false, shell: false, git: false, browser: false },
      budget: { maxTokens: 100000, maxCost: 10.00, maxRuntime: 300 },
      trustLevel: 'prod',
      secrets: [],
      maxConcurrency: 5,
      status: 'available',
    },
    {
      agentId: 'agent:research',
      name: 'research',
      role: 'research',
      description: 'Research Agent - gathers information and performs analysis',
      version: '1.0.0',
      image: 'clutch/agent-research:latest',
      endpoints: { clutch: 'http://localhost:3002/agents/research' },
      capabilities: [
        { id: 'research', version: '1.0', tags: ['web', 'analysis'] },
        { id: 'summarization', version: '1.0' },
      ],
      tools: ['web.search', 'web.fetch', 'file.write'],
      permissions: { file: true, shell: false, git: false, browser: true },
      budget: { maxTokens: 50000, maxCost: 5.00, maxRuntime: 600 },
      trustLevel: 'sandbox',
      secrets: ['SEARCH_API_KEY'],
      maxConcurrency: 3,
      status: 'available',
    },
    {
      agentId: 'agent:marketing',
      name: 'marketing',
      role: 'marketing',
      description: 'Marketing Agent - creates copy and marketing materials',
      version: '1.0.0',
      image: 'clutch/agent-marketing:latest',
      endpoints: { clutch: 'http://localhost:3002/agents/marketing' },
      capabilities: [
        { id: 'copywriting', version: '1.0' },
        { id: 'content-creation', version: '1.0', tags: ['landing', 'email'] },
      ],
      tools: ['file.write', 'web.fetch'],
      permissions: { file: true, shell: false, git: false, browser: true },
      budget: { maxTokens: 50000, maxCost: 5.00, maxRuntime: 300 },
      trustLevel: 'sandbox',
      secrets: [],
      maxConcurrency: 2,
      status: 'available',
    },
    {
      agentId: 'agent:developer',
      name: 'developer',
      role: 'developer',
      description: 'Developer Agent - writes and modifies code',
      version: '1.0.0',
      image: 'clutch/agent-developer:latest',
      endpoints: { clutch: 'http://localhost:3002/agents/developer' },
      capabilities: [
        { id: 'coding', version: '1.0', tags: ['typescript', 'react', 'node'] },
        { id: 'debugging', version: '1.0' },
        { id: 'testing', version: '1.0' },
      ],
      tools: ['file.read', 'file.write', 'shell.exec', 'git.commit', 'git.push'],
      permissions: { file: true, shell: true, git: true, browser: false },
      budget: { maxTokens: 100000, maxCost: 15.00, maxRuntime: 900 },
      trustLevel: 'sandbox',
      secrets: ['GITHUB_TOKEN'],
      maxConcurrency: 2,
      status: 'available',
    },
  ]).returning();

  const [pmAgent] = agentResults;

  console.log('Created agents:', agentResults.map(a => a.agentId));

  // Seed department channels
  const channelResults = await db.insert(schema.channels).values([
    { name: 'general', type: 'department', description: 'General discussion and announcements' },
    { name: 'research', type: 'department', description: 'Research findings and discussions' },
    { name: 'dev', type: 'department', description: 'Development discussions' },
    { name: 'ops', type: 'department', description: 'Operations and deployment' },
  ]).returning();

  const [generalChannel] = channelResults;

  console.log('Created channels:', channelResults.map(c => c.name));

  // Generate IDs for the sample task
  const runId = generateRunId();
  const taskId = generateTaskId();
  const threadId = generateThreadId();

  // Create a sample task with its channel
  const taskChannelResults = await db.insert(schema.channels).values([
    { name: 'task-1-landing-page', type: 'task', description: 'Landing page development task' },
  ]).returning();
  const taskChannel = taskChannelResults[0]!;

  const sampleTaskResults = await db.insert(schema.tasks).values([
    {
      taskId,
      runId,
      parentTaskId: null,
      title: 'Create landing page for new product',
      description: 'Research market, create marketing copy, and implement landing page',
      state: 'created',
      workflowId: 'product-development',
      channelId: taskChannel.id,
      constraints: { maxTokens: 100000, maxRuntimeSec: 3600, maxCost: 20 },
      metadata: { priority: 'high', tags: ['landing-page', 'marketing'] },
    },
  ]).returning();
  const sampleTask = sampleTaskResults[0]!;

  // Update channel with task reference
  await db.update(schema.channels)
    .set({ taskId: sampleTask.id })
    .where(eq(schema.channels.id, taskChannel.id));

  console.log('Created sample task:', sampleTask.taskId);

  // Create sample messages in general channel using Clutch Protocol format
  if (pmAgent && generalChannel) {
    const messageId = generateMessageId();

    await db.insert(schema.messages).values([
      {
        messageId,
        version: 'clutch/0.1',
        threadId,
        runId,
        taskId,
        parentTaskId: null,
        fromAgentId: pmAgent.agentId,
        toAgentIds: ['agent:research', 'agent:marketing', 'agent:developer'],
        type: 'task.request',
        domain: 'planning',
        payloadType: 'plan.outline.v1',
        payload: {
          title: 'Project kickoff plan',
          description: 'We will start by researching the market, then create marketing copy, and finally implement the landing page.',
          steps: [
            { step: 1, agent: 'agent:research', action: 'Research market and competitors' },
            { step: 2, agent: 'agent:marketing', action: 'Create marketing copy' },
            { step: 3, agent: 'agent:developer', action: 'Implement landing page' },
          ],
        },
        requires: ['planning'],
        prefers: ['coordination'],
        attachments: [],
        meta: { source: 'seed' },
        channelId: generalChannel.id,
        cost: '0.0012',
        runtime: 1500,
        tokens: 150,
      },
    ]);

    console.log('Created sample messages');
  }

  // Create audit log entry
  await db.insert(schema.auditLogs).values([
    {
      action: 'seed_database',
      entityType: 'system',
      entityId: 'system:seed',
      runId,
      details: {
        agents: 4,
        channels: 5,
        tasks: 1,
        seededAt: new Date().toISOString(),
      },
    },
  ]);

  console.log('Seed complete!');
  console.log('  Run ID:', runId);
  console.log('  Task ID:', taskId);
  console.log('  Thread ID:', threadId);

  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
