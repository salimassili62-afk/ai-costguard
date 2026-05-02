/**
 * ExecutionOS Integration Example
 * 
 * Demonstrates the mandatory execution layer pattern.
 * This shows how agents CANNOT safely execute without ExecutionOS.
 */

import { 
  ExecutionOS, 
  wrapOpenAI,
  globalIntelligence,
  policyMarketplace,
} from '../src/os';

// Simulated OpenAI client (in real use, import from 'openai')
class MockOpenAI {
  chat = {
    completions: {
      create: async (params: any) => ({
        choices: [{ message: { content: 'Mock response' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        model: params.model,
      }),
    },
  };
  responses = {
    create: async (params: any) => ({
      output: [{ content: { text: 'Mock response' } }],
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
  };
  embeddings = {
    create: async (params: any) => ({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
      usage: { total_tokens: params.input?.length || 100 },
    }),
  };
}

async function demonstrateExecutionOS() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  AI EXECUTION OPERATING SYSTEM (AIE-OS)');
  console.log('  Mandatory Runtime Layer for AI Agents');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Step 1: Initialize ExecutionOS
  console.log('🔧 Step 1: Initialize ExecutionOS');
  console.log('   → Creating mandatory runtime layer');
  
  const os = new ExecutionOS({
    tenantId: 'demo-tenant',
    mode: 'strict',        // Cannot be bypassed
    defaultBudget: 10,     // $10 per execution
    strictMode: true,      // Required for safety
    globalIntelligence: true,
    policyAutoApply: true,
  });
  
  console.log('   ✅ ExecutionOS initialized\n');

  // Step 2: Install community policies
  console.log('📦 Step 2: Install Community Policies');
  console.log('   → Downloading from Policy Marketplace');
  
  const policies = policyMarketplace.searchPolicies({ 
    category: 'cost_control',
    status: 'verified',
    limit: 3,
  });
  
  for (const policy of policies) {
    policyMarketplace.installPolicy('demo-tenant', policy.id);
    console.log(`   ✅ Installed: ${policy.name} (${policy.downloadCount} downloads)`);
  }
  
  console.log(`   📊 Switching cost: ${JSON.stringify(policyMarketplace.calculateSwitchingCost('demo-tenant'))}\n`);

  // Step 3: Wrap OpenAI SDK
  console.log('🔌 Step 3: SDK Interception');
  console.log('   → Wrapping OpenAI client (mandatory)');
  
  const mockOpenAI = new MockOpenAI();
  const wrappedOpenAI = wrapOpenAI(os, mockOpenAI, 'demo-agent');
  
  console.log('   ✅ All SDK calls now route through ExecutionOS');
  console.log('   ⚠️  Direct calls bypass safety - NOT ALLOWED\n');

  // Step 4: Execute through OS (safe path)
  console.log('🚀 Step 4: Safe Execution');
  console.log('   → Planning execution through OS...\n');
  
  try {
    // This routes through ExecutionOS
    const result = await wrappedOpenAI.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello, world!' }],
      max_tokens: 100,
    });
    
    console.log('   ✅ Execution cleared by OS');
    console.log(`   📊 Tokens: ${result.usage.total_tokens}`);
    console.log(`   💰 Cost: ~$${(result.usage.total_tokens / 1000 * 0.03).toFixed(4)}\n`);
    
  } catch (error: any) {
    console.log(`   ❌ Blocked: ${error.message}\n`);
  }

  // Step 5: Show what happens when removing OS
  console.log('⚠️  Step 5: Dependency Demonstration');
  console.log('   → Simulating direct SDK call (UNSAGE):');
  console.log('   ```typescript');
  console.log('   // WITHOUT ExecutionOS - DANGEROUS');
  console.log('   const openai = new OpenAI({ apiKey });');
  console.log('   await openai.chat.completions.create({...});');
  console.log('   // ☠️  No cost protection');
  console.log('   // ☠️  No loop detection');
  console.log('   // ☠️  No security checks');
  console.log('   ```\n');

  // Step 6: Global Intelligence
  console.log('🧠 Step 6: Global Intelligence Network');
  console.log('   → Contributing anonymized patterns...');
  
  // Contribute to global intelligence
  globalIntelligence.contribute({
    tenantId: 'demo-tenant',
    timestamp: Date.now(),
    patternType: 'cost_explosion',
    patternFingerprint: 'demo-pattern-1',
    outcome: 'prevented',
    preventedCost: 5.00,
    confidence: 0.95,
  });
  
  const networkMetrics = globalIntelligence.getNetworkMetrics();
  console.log(`   📊 Total patterns: ${networkMetrics.totalPatterns}`);
  console.log(`   📊 Contributing tenants: ${networkMetrics.contributingTenants}`);
  console.log(`   📊 Average improvement: ${Math.round(networkMetrics.averageImprovementRate * 100)}%\n`);

  // Step 7: Show metrics
  console.log('📈 Step 7: System Metrics');
  const osMetrics = os.getMetrics();
  console.log(`   📊 Total executions: ${osMetrics.totalExecutions}`);
  console.log(`   📊 Blocked: ${osMetrics.blockedExecutions}`);
  console.log(`   📊 Avg latency: ${osMetrics.avgLatencyMs.toFixed(2)}ms`);
  console.log(`   💰 Cost prevented: $${osMetrics.totalCostPrevented.toFixed(2)}\n`);

  // Final summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅ ExecutionOS Successfully Integrated');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('🔒 SAFETY GUARANTEES:');
  console.log('   • All executions routed through safety checks');
  console.log('   • Cost limits enforced at runtime');
  console.log('   • Global intelligence protecting from known patterns');
  console.log('   • Community policies providing additional guardrails\n');
  
  console.log('⚡ IRREVERSIBLE DEPENDENCY:');
  console.log('   • Removing ExecutionOS = bypassing all safety');
  console.log('   • Direct SDK calls = uncontrolled execution');
  console.log('   • Cost explosions possible');
  console.log('   • Security vulnerabilities exposed\n');
  
  console.log('🌐 NETWORK EFFECTS:');
  console.log('   • Your deployments improve detection for all');
  console.log('   • Global intelligence continuously improves');
  console.log('   • Community policies shared across tenants');
  console.log('   • Ecosystem lock-in through policy marketplace\n');
}

// Run demonstration
if (require.main === module) {
  demonstrateExecutionOS().catch(console.error);
}

export { demonstrateExecutionOS };
