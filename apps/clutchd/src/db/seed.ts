import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.js';
import { generateThreadId, generateRunId, generateTaskId } from '@clutch/protocol';

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

  // No pre-seeded agents — users hire their first agent via the UI
  console.log('Skipping agent seeding (empty-start onboarding)');

  // Seed department channels
  const channelResults = await db.insert(schema.channels).values([
    { name: 'general', type: 'department', description: 'General discussion and announcements' },
    { name: 'research', type: 'department', description: 'Research findings and discussions' },
    { name: 'dev', type: 'department', description: 'Development discussions' },
    { name: 'ops', type: 'department', description: 'Operations and deployment' },
  ]).returning();

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

  // No sample messages — start clean for onboarding
  console.log('Skipping message seeding (no agents yet)');

  // Create audit log entry
  await db.insert(schema.auditLogs).values([
    {
      action: 'seed_database',
      entityType: 'system',
      entityId: 'system:seed',
      runId,
      details: {
        agents: 0,
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
