/**
 * AERL - AI Execution Reliability Layer
 * Real Production Usage Example
 * 
 * This demonstrates actual integration for ensuring agent success.
 */

import { aerl } from '../src/aerl';

// Simulated LLM client
const mockLLM = {
  generate: async (params: { model: string; prompt: string; maxTokens?: number }) => ({
    text: 'Generated response',
    tokens: params.maxTokens || 100,
    cost: (params.maxTokens || 100) * 0.00003,
  }),
};

async function autonomousAgentWorkflow() {
  const workflowId = `wf-${Date.now()}`;
  const sessionId = `sess-${Date.now()}`;
  const agentId = 'research-agent-v2';

  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     AERL - Autonomous Agent Execution                  ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // 1. INITIALIZE WORKFLOW
  aerl.initWorkflow(workflowId, sessionId);
  console.log(`Initialized workflow: ${workflowId}\n`);

  let stepNumber = 0;
  let totalCost = 0;
  let totalTokens = 0;
  let successCount = 0;
  let failureCount = 0;
  const recentResults: ('success' | 'failure' | 'partial')[] = [];

  const maxSteps = 8;

  while (stepNumber < maxSteps) {
    stepNumber++;

    // 2. ESTIMATE EXECUTION COST
    const estimatedTokens = 1500 + Math.random() * 1000;
    const estimatedCost = estimatedTokens * 0.00003;

    // 3. AERL INTERCEPTION (<5ms)
    console.log(`━ Step ${stepNumber} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    const decision = aerl.intercept({
      id: `step-${stepNumber}`,
      provider: 'openai',
      operation: 'chat.completions.create',
      model: 'gpt-4',
      estimatedTokens,
      estimatedCost,
      context: {
        sessionId,
        agentId,
        workflowId,
        stepNumber,
        previousSteps: stepNumber - 1,
        totalCost,
        totalTokens,
        successCount,
        failureCount,
        startTime: Date.now(),
        goal: 'research-task-123',
      },
      inputHash: `hash-of-prompt-${stepNumber}`,
      dependencies: stepNumber > 1 ? [`step-${stepNumber - 1}`] : undefined,
    });

    console.log(`Decision: ${decision.action.toUpperCase()}`);
    console.log(`Reliability Score: ${(decision.reliabilityScore * 100).toFixed(0)}%`);
    console.log(`Latency: ${decision.latencyMs.toFixed(2)}ms`);
    console.log(`Reason: ${decision.reason}`);

    // 4. HANDLE DIFFERENT DECISIONS
    if (decision.action === 'block') {
      console.log(`⚠️  BLOCKED - Saved: $${decision.estimatedSavings?.toFixed(4)}`);
      
      // Check for recovery alternatives
      const recovery = aerl.recoverExecution('gpt-4', 'block', decision.suggestedModification?.alternativeTool);
      if (recovery.alternatives.length > 0) {
        console.log(`Recovery alternatives: ${recovery.alternatives.length}`);
        console.log(`Best alternative: ${recovery.alternatives[0].reason}`);
      }
      
      failureCount++;
      recentResults.push('failure');
      break;
    }

    if (decision.action === 'modify') {
      console.log(`🔧 MODIFIED - Using alternative approach`);
      if (decision.suggestedModification?.alternativeTool) {
        console.log(`Alternative tool: ${decision.suggestedModification.alternativeTool}`);
      }
    }

    // 5. PREDICT FAILURE BEFORE EXECUTION
    const prediction = aerl.predictFailure(workflowId, 'chat.completions.create');
    if (prediction.riskScore > 0.5) {
      console.log(`⚡ Failure Prediction: ${(prediction.riskScore * 100).toFixed(0)}% risk`);
      console.log(`Warning: ${prediction.warningSignals.join(', ')}`);
    }

    // 6. EXECUTE (with optional modification)
    const toolToUse = decision.suggestedModification?.alternativeTool || 'gpt-4';
    const maxTokens = decision.suggestedModification?.parameterAdjustments?.max_tokens || 1500;
    
    console.log(`▶️  Executing with ${toolToUse}...`);
    
    const result = await mockLLM.generate({
      model: toolToUse,
      prompt: `Step ${stepNumber} task`,
      maxTokens,
    });

    // Simulate occasional failures for demo
    const actualSuccess = Math.random() > 0.1; // 90% success rate
    const actualCost = result.cost;

    // 7. TRACK IN EXECUTION GRAPH
    aerl.trackGraph(workflowId, {
      id: `step-${stepNumber}`,
      type: 'llm',
      status: actualSuccess ? 'success' : 'failure',
      operation: 'chat.completions.create',
      inputHash: `hash-of-prompt-${stepNumber}`,
      outputHash: `hash-of-output-${stepNumber}`,
      cost: actualCost,
      tokens: result.tokens,
      durationMs: 800 + Math.random() * 400,
      timestamp: Date.now(),
    }, stepNumber > 1 ? [`step-${stepNumber - 1}`] : undefined);

    // 8. UPDATE METRICS
    totalCost += actualCost;
    totalTokens += result.tokens;
    
    if (actualSuccess) {
      successCount++;
      recentResults.push('success');
      console.log(`✅ SUCCESS - Cost: $${actualCost.toFixed(4)}`);
    } else {
      failureCount++;
      recentResults.push('failure');
      console.log(`❌ FAILURE - Cost: $${actualCost.toFixed(4)}`);
    }

    // 9. RECORD RESULT FOR TELEMETRY
    aerl.recordResult(`step-${stepNumber}`, actualCost, actualSuccess);

    // 10. CHECK RELIABILITY SCORE
    if (stepNumber % 3 === 0) {
      const reliability = aerl.scoreExecution({
        sessionId,
        workflowId,
        stepNumber,
        recentResults,
        totalCost,
        tokenVelocity: totalTokens / (stepNumber * 2), // tokens per minute estimate
        costVelocity: totalCost / (stepNumber * 2),    // cost per minute estimate
      });

      console.log(`\nReliability Check:`);
      console.log(`  Score: ${(reliability.score * 100).toFixed(0)}%`);
      console.log(`  Factors:`);
      console.log(`    - Failure probability: ${(reliability.factors.failureProbability * 100).toFixed(0)}%`);
      console.log(`    - Cost explosion: ${(reliability.factors.costExplosionProbability * 100).toFixed(0)}%`);
      console.log(`    - Redundancy: ${(reliability.factors.redundancyProbability * 100).toFixed(0)}%`);
      console.log(`    - Goal drift: ${(reliability.factors.goalDriftProbability * 100).toFixed(0)}%`);
    }

    // 11. ANALYZE WORKFLOW GRAPH
    const graphAnalysis = aerl.analyzeGraph(workflowId);
    if (graphAnalysis.hasLoop) {
      console.log(`🔄 LOOP DETECTED in workflow!`);
    }
    if (graphAnalysis.retryStorm) {
      console.log(`⛈️  RETRY STORM detected!`);
    }
    if (graphAnalysis.redundantBranches.length > 0) {
      console.log(`♻️  ${graphAnalysis.redundantBranches.length} redundant branches found`);
    }

    console.log(''); // Blank line between steps
  }

  // 12. FINAL SUMMARY
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('EXECUTION SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const metrics = aerl.getMetrics();
  const dashboard = aerl.getDashboard();

  console.log(`Total Steps: ${stepNumber}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed/Blocked: ${failureCount}`);
  console.log(`Total Cost: $${totalCost.toFixed(4)}`);
  console.log(`\nReliability Metrics:`);
  console.log(`  Success Rate: ${(metrics.successfulExecutions / metrics.totalExecutions * 100).toFixed(0)}%`);
  console.log(`  Failures Prevented: ${metrics.failuresPrevented}`);
  console.log(`  False Positives: ${metrics.falsePositives}`);
  console.log(`  Prediction Accuracy: ${(metrics.predictionAccuracy * 100).toFixed(0)}%`);
  console.log(`\nFinancial Impact:`);
  console.log(`  Cost Saved: $${metrics.estimatedCostSaved.toFixed(2)}`);
  console.log(`  Actual Spend: $${metrics.actualSpend.toFixed(2)}`);
  console.log(`  Net Savings: $${metrics.netSavings.toFixed(2)}`);
  console.log(`\nPerformance:`);
  console.log(`  Avg Decision Latency: ${metrics.avgDecisionLatencyMs.toFixed(2)}ms`);
  console.log(`  P95 Decision Latency: ${metrics.p95DecisionLatencyMs.toFixed(2)}ms`);

  // 13. EXPORT TELEMETRY
  const csv = aerl.exportCSV();
  console.log(`\nTelemetry: ${csv.split('\n').length - 1} events logged`);

  // 14. 7-DAY REPORT PREVIEW
  const report7Day = aerl.get7DayReport();
  console.log(`\n7-Day Report Preview:`);
  console.log(`  Daily entries: ${report7Day.daily.length}`);
  if (report7Day.daily.length > 0) {
    console.log(`  Latest reliability: ${(report7Day.daily[report7Day.daily.length - 1].reliabilityScore * 100).toFixed(0)}%`);
  }
}

// Run the example
autonomousAgentWorkflow().catch(console.error);
