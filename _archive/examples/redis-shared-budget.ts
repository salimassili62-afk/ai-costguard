/**
 * redis-shared-budget.ts
 *
 * AI CostGuard Pro — Multi-process shared budget example.
 *
 * Scenario: two independent Node.js workers both charge spend against the same
 * Redis-backed budget for a project. GuardPro throws GuardError('...', context,
 * 'BUDGET_EXCEEDED') as soon as the combined spend exceeds the budget, regardless
 * of which worker made the last request.
 *
 * Run after building the package:
 *   npx ts-node redis-shared-budget.ts
 *
 * Requires:
 *   npm install @salimassili/ai-costguard ioredis
 *   REDIS_URL=redis://localhost:6379
 */

import { GuardPro } from '@salimassili/ai-costguard/pro';
import { GuardError } from '@salimassili/ai-costguard';

// ─── Configuration ────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Both workers share the same redisUrl. GuardPro pools the underlying ioredis
// connection per URL, so one TCP connection is reused.
const SHARED_CONFIG = {
  redisUrl: REDIS_URL,
  budget: 0.10,        // $0.10 shared budget across all workers for this project
  windowSeconds: 3600, // 1-hour rolling window
  slackWebhook: process.env.SLACK_WEBHOOK_URL,
};

// ─── Simulated Worker A ───────────────────────────────────────────────────────

async function workerA(): Promise<void> {
  // Each worker creates its own GuardPro instance. They share the Redis key
  // costguard:spend:project-demo because they use the same redisUrl.
  const pro = new GuardPro(SHARED_CONFIG);

  console.log('[Worker A] connected:', pro.isConnected());

  try {
    // Simulate three requests totalling $0.075
    await pro.checkAndCharge('project-demo', 0.025);
    console.log('[Worker A] request 1 allowed — $0.025 charged');

    await pro.checkAndCharge('project-demo', 0.025);
    console.log('[Worker A] request 2 allowed — $0.025 charged');

    await pro.checkAndCharge('project-demo', 0.025);
    console.log('[Worker A] request 3 allowed — $0.025 charged');
  } catch (error) {
    if (error instanceof GuardError && error.code === 'BUDGET_EXCEEDED') {
      console.error('[Worker A] BLOCKED —', error.message);
    } else {
      throw error;
    }
  } finally {
    await pro.shutdown();
  }
}

// ─── Simulated Worker B ───────────────────────────────────────────────────────

async function workerB(): Promise<void> {
  const pro = new GuardPro(SHARED_CONFIG);

  // Read current spend before charging
  const currentSpend = await pro.getSpend('project-demo');
  console.log(`[Worker B] current spend: $${currentSpend.toFixed(6)}`);

  try {
    // This charge should push combined spend over the $0.10 budget
    await pro.checkAndCharge('project-demo', 0.05);
    console.log('[Worker B] request allowed — $0.05 charged');
  } catch (error) {
    if (error instanceof GuardError && error.code === 'BUDGET_EXCEEDED') {
      // GuardError.metadata includes the full context snapshot
      console.error('[Worker B] BLOCKED — BUDGET_EXCEEDED');
      console.error('[Worker B] estimated cost:', error.context.estimatedCost);
      console.error('[Worker B] metadata:', JSON.stringify(error.metadata, null, 2));
    } else {
      throw error;
    }
  } finally {
    await pro.shutdown();
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Reset spend at the start of the demo so it runs cleanly each time.
  // In production you would NOT reset spend between requests — only on billing
  // cycle rollover via a scheduled job or manual operation.
  const admin = new GuardPro(SHARED_CONFIG);
  await admin.resetSpend('project-demo');
  await admin.shutdown();
  console.log('[main] spend reset for project-demo');

  // Run workers sequentially so the spend order is deterministic in this demo.
  // In production these would be separate processes or worker_threads.
  await workerA();
  await workerB();

  console.log('[main] done');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
