import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.js';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://clutch:clutch@localhost:5432/clutch';

async function main() {
  console.log('Seeding database...');

  const client = postgres(DATABASE_URL);
  const db = drizzle(client, { schema });

  // Clear existing data
  await db.delete(schema.auditLogs);
  await db.delete(schema.reviews);
  await db.delete(schema.messages);
  await db.delete(schema.tasks);
  await db.delete(schema.channels);
  await db.delete(schema.agents);

  // Seed agents
  const agentResults = await db.insert(schema.agents).values([
    {
      name: 'pm',
      role: 'pm',
      description: 'Project Manager - orchestrates tasks and coordinates agents',
      image: 'clutch/agent-pm:latest',
      permissions: { file: false, shell: false, git: false, browser: false },
      budget: { maxTokens: 100000, maxCost: 10.00, maxRuntime: 300 },
      secrets: [],
      status: 'available',
    },
    {
      name: 'research',
      role: 'research',
      description: 'Research Agent - gathers information and performs analysis',
      image: 'clutch/agent-research:latest',
      permissions: { file: true, shell: false, git: false, browser: true },
      budget: { maxTokens: 50000, maxCost: 5.00, maxRuntime: 600 },
      secrets: ['SEARCH_API_KEY'],
      status: 'available',
    },
    {
      name: 'marketing',
      role: 'marketing',
      description: 'Marketing Agent - creates copy and marketing materials',
      image: 'clutch/agent-marketing:latest',
      permissions: { file: true, shell: false, git: false, browser: true },
      budget: { maxTokens: 50000, maxCost: 5.00, maxRuntime: 300 },
      secrets: [],
      status: 'available',
    },
    {
      name: 'developer',
      role: 'developer',
      description: 'Developer Agent - writes and modifies code',
      image: 'clutch/agent-developer:latest',
      permissions: { file: true, shell: true, git: true, browser: false },
      budget: { maxTokens: 100000, maxCost: 15.00, maxRuntime: 900 },
      secrets: ['GITHUB_TOKEN'],
      status: 'available',
    },
  ]).returning();

  const [pmAgent] = agentResults;

  console.log('Created agents:', agentResults.map(a => a.name));

  // Seed department channels
  const channelResults = await db.insert(schema.channels).values([
    { name: 'general', type: 'department', description: 'General discussion and announcements' },
    { name: 'research', type: 'department', description: 'Research findings and discussions' },
    { name: 'dev', type: 'department', description: 'Development discussions' },
    { name: 'ops', type: 'department', description: 'Operations and deployment' },
  ]).returning();

  const [generalChannel] = channelResults;

  console.log('Created channels:', channelResults.map(c => c.name));

  // Create a sample task with its channel
  const taskChannelResults = await db.insert(schema.channels).values([
    { name: 'task-1-landing-page', type: 'task', description: 'Landing page development task' },
  ]).returning();
  const taskChannel = taskChannelResults[0]!;

  const sampleTaskResults = await db.insert(schema.tasks).values([
    {
      title: 'Create landing page for new product',
      description: 'Research market, create marketing copy, and implement landing page',
      state: 'created',
      workflowId: 'product-development',
      channelId: taskChannel.id,
    },
  ]).returning();
  const sampleTask = sampleTaskResults[0]!;

  // Update channel with task reference
  await db.update(schema.channels)
    .set({ taskId: sampleTask.id })
    .where(eq(schema.channels.id, taskChannel.id));

  console.log('Created sample task:', sampleTask.title);

  // Create sample messages in general channel
  if (pmAgent && generalChannel) {
    await db.insert(schema.messages).values([
      {
        type: 'PLAN',
        channelId: generalChannel.id,
        senderId: pmAgent.id,
        summary: 'Project kickoff plan',
        body: 'We will start by researching the market, then create marketing copy, and finally implement the landing page.',
        artifacts: [],
        citations: [],
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
      entityId: '00000000-0000-0000-0000-000000000000',
      details: {
        agents: 4,
        channels: 5,
        tasks: 1,
        seededAt: new Date().toISOString(),
      },
    },
  ]);

  console.log('Seed complete!');
  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
