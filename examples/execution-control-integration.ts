/**
 * AI Execution Control Platform - Integration Example
 * 
 * This example demonstrates how to integrate the full execution control layer
 * into an AI agent application with multi-step workflows.
 */

import {
  ExecutionInterceptor,
  AgentBehaviorGraph,
  PolicyEngine,
  CostPredictionEngine,
  LearningSystem,
  ExplainabilityLayer,
  PolicySet,
} from '../src';

// Initialize the control plane
const interceptor = new ExecutionInterceptor({
  mode: 'sdk',
  tenantId: 'tenant-123',
  failOpen: true,
  maxLatencyMs: 10,
  localCacheSize: 10000,
});

const behaviorGraph = new AgentBehaviorGraph();
const policyEngine = new PolicyEngine();
const costPredictor = new CostPredictionEngine();
const learning = new LearningSystem();
const explainer = new ExplainabilityLayer();

// Set up tenant policies
const tenantPolicy: PolicySet = {
  id: 'tenant-policy-123',
  tenantId: 'tenant-123',
  level: 'tenant',
  targetId: 'tenant-123',
  rules: [
    {
      id: 'max-cost',
      name: 'Maximum Cost Per Workflow',
      description: 'Block workflows exceeding $10',
      enabled: true,
      priority: 100,
      condition: {
        type: 'cost_threshold',
        operator: 'gt',
        threshold: 10,
      },
      action: 'block',
    },
    {
      id: 'loop-detection',
      name: 'Loop Detection',
      description: 'Block when loops are detected',
      enabled: true,
      priority: 95,
      condition: {
        type: 'loop_detected',
        operator: 'eq',
        threshold: true,
      },
      action: 'block',
    },
  ],
  defaultAction: 'allow',
  maxCostPerWorkflow: 10,
  maxDepth: 10,
  maxTokensPerRequest: 100000,
  repetitionThreshold: 0.8,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

policyEngine.registerPolicy(tenantPolicy);

// Example: Multi-step AI Agent Workflow
async function runAgentWorkflow(userQuery: string) {
  const sessionId = `session-${Date.now()}`;
  const workflowId = `workflow-${Date.now()}`;
  
  console.log('\n🚀 Starting AI Agent Workflow');
  console.log(`Query: "${userQuery}"`);
  console.log(`Session: ${sessionId}`);
  console.log(`Workflow: ${workflowId}\n`);

  let stepCount = 0;
  let totalCost = 0;
  const maxSteps = 10;

  while (stepCount < maxSteps) {
    stepCount++;
    
    // Step 1: Create execution request
    const request = {
      id: `req-${stepCount}`,
      type: 'agent' as const,
      provider: 'openai',
      model: 'gpt-4',
      prompt: `Step ${stepCount}: Processing user query: ${userQuery}`,
      estimatedTokens: 2000,
      estimatedCost: 0.06,
      context: {
        tenantId: 'tenant-123',
        sessionId,
        workflowId,
        requestId: `req-${stepCount}`,
        timestamp: Date.now(),
        mode: 'sdk' as const,
        source: 'agent',
      },
      metadata: {
        stepCount,
        userQuery,
      },
    };

    // Step 2: Record action in behavior graph
    const action = behaviorGraph.recordAction({
      sessionId,
      workflowId,
      tenantId: 'tenant-123',
      type: 'agent_step',
      provider: 'openai',
      model: 'gpt-4',
      input: request.prompt,
      tokensUsed: request.estimatedTokens,
      cost: request.estimatedCost,
      parentActionId: stepCount > 1 ? `action-${stepCount - 1}` : undefined,
      childActionIds: [],
      metadata: {},
    });

    // Step 3: Intercept and evaluate
    const startTime = performance.now();
    const decision = await interceptor.intercept(request);
    const latency = performance.now() - startTime;

    console.log(`\n📍 Step ${stepCount}`);
    console.log(`⏱️  Latency: ${decision.latencyMs.toFixed(2)}ms`);
    console.log(`🎯 Decision: ${decision.decision.toUpperCase()}`);
    console.log(`📊 Confidence: ${Math.round(decision.confidence * 100)}%`);

    // Step 4: If allowed, predict cost-to-go
    if (decision.decision === 'allow' || decision.decision === 'throttle') {
      const prediction = costPredictor.predict({
        currentCost: totalCost + request.estimatedCost,
        currentTokens: request.estimatedTokens * stepCount,
        model: 'gpt-4',
        workflowStep: stepCount,
        maxExpectedSteps: maxSteps,
        averageToolCallsPerStep: 1,
        averageToolCost: 0.02,
      });

      const budgetAnalysis = costPredictor.analyzeBudget(
        10, // $10 budget
        totalCost,
        prediction,
        sessionId
      );

      console.log(`💰 Current: $${totalCost.toFixed(2)}`);
      console.log(`📈 Predicted Total: $${prediction.predictedTotal.toFixed(2)}`);
      console.log(`⚠️  Risk Level: ${prediction.riskLevel.toUpperCase()}`);

      // Check if we should stop due to budget
      if (budgetAnalysis.willExceed) {
        console.log(`\n🚨 BUDGET ALERT: Would exceed $10 budget`);
        console.log(`Projected exceed: $${budgetAnalysis.projectedExceedAmount.toFixed(2)}`);
        
        // Record in learning system
        learning.recordPattern({
          patternType: 'cost_explosion',
          input: request.prompt,
          actionSequence: ['agent_step'],
          actionCount: stepCount,
          durationMs: Date.now() - parseInt(sessionId.split('-')[1]),
          totalCost: totalCost,
          depth: stepCount,
          branchFactor: 1,
          outcome: 'blocked',
          preventedCost: budgetAnalysis.projectedExceedAmount,
          confidence: 0.9,
        });

        break;
      }

      // Execute the step (simulated)
      totalCost += request.estimatedCost;
      console.log(`✅ Step executed (simulated)`);
      
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Step 5: If blocked, explain why
    if (decision.decision === 'block') {
      console.log(`\n🚫 EXECUTION BLOCKED`);
      console.log(`Reason: ${decision.reason}`);

      // Get behavior analysis
      const behaviorAnalysis = behaviorGraph.analyzeWorkflow(workflowId);

      // Generate explanation
      const explanation = explainer.explain(
        {
          decision: decision.decision,
          requestId: request.id,
          workflowId,
          sessionId,
          timestamp: Date.now(),
          input: request.prompt,
          provider: request.provider,
          model: request.model,
        },
        decision,
        behaviorAnalysis || undefined,
        undefined,
        undefined
      );

      console.log('\n' + explainer.formatForCLI(explanation));

      // Record blocked pattern
      if (behaviorAnalysis) {
        learning.recordPattern({
          patternType: behaviorAnalysis.loop.detected ? 'loop' : 'anomaly',
          input: request.prompt,
          actionSequence: ['agent_step'],
          actionCount: stepCount,
          durationMs: Date.now() - parseInt(sessionId.split('-')[1]),
          totalCost: totalCost,
          depth: stepCount,
          branchFactor: 1,
          outcome: 'blocked',
          preventedCost: totalCost,
          confidence: decision.confidence,
        });
      }

      break;
    }

    // Check for natural completion (e.g., answer found)
    if (stepCount >= 3 && Math.random() > 0.7) {
      console.log('\n✅ Workflow completed naturally');
      break;
    }
  }

  // Final summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 WORKFLOW SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Steps executed: ${stepCount}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
  console.log(`Average latency: ${interceptor.getMetrics().avgLatencyMs.toFixed(2)}ms`);

  // Show learning system stats
  const stats = learning.getStats();
  console.log(`\n🧠 Learning System:`);
  console.log(`  Total patterns: ${stats.totalPatterns}`);
  console.log(`  Prevented cost: $${stats.totalPreventedCost.toFixed(2)}`);
  console.log(`  Average accuracy: ${Math.round(stats.averageAccuracy * 100)}%`);

  return {
    steps: stepCount,
    cost: totalCost,
    completed: stepCount < maxSteps,
  };
}

// Run the example
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛡️  AI EXECUTION CONTROL PLATFORM');
  console.log('   Demo: Multi-Step Agent Workflow');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const result = await runAgentWorkflow(
      "Analyze the market trends for AI safety tools in 2026"
    );
    
    console.log('\n✨ Demo completed successfully');
    console.log('Result:', result);
  } catch (error) {
    console.error('❌ Demo failed:', error);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  main();
}

export { runAgentWorkflow };
