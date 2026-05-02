/**
 * AECL - Real Production Usage Example
 * 
 * This shows actual integration, NOT marketing fluff.
 */

import { aecl } from '../src/aecl';

// Simulated OpenAI client
const mockOpenAI = {
  chat: {
    completions: {
      create: async (params: any) => ({
        usage: { total_tokens: 150 },
        choices: [{ message: { content: 'Response' } }],
      }),
    },
  },
};

async function agentWorkflow() {
  const sessionId = `sess-${Date.now()}`;
  const agentId = 'research-agent-1';
  
  console.log('Starting agent workflow...\n');

  let stepNumber = 0;
  let totalCost = 0;
  let totalTokens = 0;
  const maxSteps = 10;

  while (stepNumber < maxSteps) {
    stepNumber++;

    // 1. ESTIMATE COST
    const estimatedTokens = 2000;
    const estimatedCost = 0.06; // $0.06 at $0.03/1K tokens

    // 2. AECL INTERCEPTION (<5ms)
    const decision = aecl.intercept({
      id: `req-${stepNumber}`,
      provider: 'openai',
      operation: 'chat.completions.create',
      model: 'gpt-4',
      estimatedTokens,
      estimatedCost,
      context: {
        sessionId,
        agentId,
        stepNumber,
        previousCalls: stepNumber - 1,
        totalTokens,
        totalCost,
        startTime: Date.now(),
      },
      inputHash: `hash-of-step-${stepNumber}`,
    });

    console.log(`Step ${stepNumber}:`);
    console.log(`  Decision: ${decision.decision.toUpperCase()}`);
    console.log(`  Risk Score: ${(decision.riskScore * 100).toFixed(0)}%`);
    console.log(`  Latency: ${decision.latencyMs.toFixed(2)}ms`);
    console.log(`  Reason: ${decision.reason}`);

    // 3. LOG DECISION FOR ROI TRACKING
    aecl.logDecision({
      timestamp: Date.now(),
      sessionId,
      requestId: `req-${stepNumber}`,
      decision: decision.decision,
      riskScore: decision.riskScore,
      estimatedCost,
      policyTriggered: decision.policyTriggered,
      reason: decision.reason,
      latencyMs: decision.latencyMs,
    });

    // 4. HANDLE BLOCK
    if (decision.decision === 'block') {
      console.log(`  BLOCKED - Estimated savings: $${decision.estimatedSavings?.toFixed(2)}\n`);
      break;
    }

    // 5. EXECUTE (if allowed)
    const result = await mockOpenAI.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: `Step ${stepNumber}` }],
    });

    // 6. RECORD ACTUAL COST
    const actualCost = (result.usage.total_tokens / 1000) * 0.03;
    totalCost += actualCost;
    totalTokens += result.usage.total_tokens;

    aecl.recordExecution(sessionId, {
      stepNumber,
      operation: 'chat.completions.create',
      inputHash: `hash-of-step-${stepNumber}`,
      cost: actualCost,
      tokens: result.usage.total_tokens,
      timestamp: Date.now(),
      durationMs: 1000,
    });

    console.log(`  EXECUTED - Actual cost: $${actualCost.toFixed(4)}\n`);

    // Check deduplication
    const dupCheck = aecl.checkDuplicate(sessionId, `hash-of-step-${stepNumber}`, 'chat.completions.create');
    if (dupCheck.isDuplicate) {
      console.log(`  WARNING: ${dupCheck.previousOccurrences} previous identical calls`);
    }
  }

  // 7. SHOW ROI
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SESSION SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const dashboard = aecl.getDashboard();
  console.log(`Steps executed: ${stepNumber}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
  console.log(`Today's savings: $${dashboard.savingsToday.toFixed(2)}`);
  console.log(`Total savings: $${dashboard.totalSavings.toFixed(2)}`);
  console.log(`7-day ROI: ${dashboard.roi7Day.toFixed(0)}%`);

  // Export CSV for billing
  const csv = aecl.exportCSV();
  console.log(`\nCSV exported: ${csv.split('\n').length} rows`);
}

// Run example
agentWorkflow().catch(console.error);
