/**
 * CostGuard - Usage Example
 * 
 * ONE LINE INTEGRATION
 * Just wrap your SDK client.
 */

import { guard } from '../src/cost-guard';

// Simulated OpenAI client
class MockOpenAI {
  chat = {
    completions: {
      create: async (params: any) => {
        // Simulate occasional slow response
        await new Promise(r => setTimeout(r, 100));
        return {
          choices: [{ message: { content: `Result for: ${params.messages[0].content}` } }],
          usage: { total_tokens: params.max_tokens || 1000 },
        };
      },
    },
  };
}

async function runExample() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  CostGuard - One-Line Cost Prevention                  ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // ═══════════════════════════════════════════════════════════════
  // ONE LINE INTEGRATION
  // ═══════════════════════════════════════════════════════════════
  
  const client = guard(new MockOpenAI() as any);
  
  console.log('✅ Client wrapped with CostGuard\n');

  // ═══════════════════════════════════════════════════════════════
  // EXAMPLE 1: Normal execution (within limits)
  // ═══════════════════════════════════════════════════════════════
  
  console.log('Example 1: Normal execution');
  console.log('─────────────────────────────');
  
  try {
    const result = await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello world' }],
      max_tokens: 500,
    });
    console.log('✅ Allowed:', result.choices[0].message.content);
  } catch (error: any) {
    console.log('❌ Blocked:', error.message);
  }

  // ═══════════════════════════════════════════════════════════════
  // EXAMPLE 2: Loop that gets stopped
  // ═══════════════════════════════════════════════════════════════
  
  console.log('\nExample 2: Loop detection (stops at step 50)');
  console.log('──────────────────────────────────────────────');
  
  // Create new guarded client for separate session
  const loopClient = guard(new MockOpenAI() as any, 'loop-session');
  
  let executedSteps = 0;
  
  for (let i = 0; i < 60; i++) {
    try {
      await loopClient.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: `Loop iteration ${i}` }],
        max_tokens: 1000,
      });
      executedSteps++;
    } catch (error: any) {
      console.log(`🛑 Stopped at step ${i}: ${error.message}`);
      if (error.guardResult) {
        console.log(`   Reason: ${error.guardResult.reason}`);
        console.log(`   Would have spent: $${error.guardResult.blockedCost?.toFixed(4)}`);
      }
      break;
    }
  }
  
  console.log(`   Total steps executed: ${executedSteps} (limit: 50)`);

  // ═══════════════════════════════════════════════════════════════
  // EXAMPLE 3: Duplicate call detection
  // ═══════════════════════════════════════════════════════════════
  
  console.log('\nExample 3: Duplicate detection (blocks at 3rd identical call)');
  console.log('─────────────────────────────────────────────────────────────');
  
  const dupClient = guard(new MockOpenAI() as any, 'dup-session');
  const samePrompt = { model: 'gpt-4', messages: [{ role: 'user', content: 'Same prompt' }], max_tokens: 500 };
  
  for (let i = 0; i < 5; i++) {
    try {
      await dupClient.chat.completions.create(samePrompt);
      console.log(`   Call ${i + 1}: Allowed`);
    } catch (error: any) {
      console.log(`   Call ${i + 1}: 🛑 Blocked - ${error.message}`);
      break;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EXAMPLE 4: Cost limit protection
  // ═══════════════════════════════════════════════════════════════
  
  console.log('\nExample 4: Cost limit (stops after ~$10)');
  console.log('─────────────────────────────────────────');
  
  const costClient = guard(new MockOpenAI() as any, 'cost-session');
  let totalSpent = 0;
  
  for (let i = 0; i < 100; i++) {
    try {
      await costClient.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: `Expensive call ${i}` }],
        max_tokens: 5000, // $0.15 per call
      });
      totalSpent += 0.15;
    } catch (error: any) {
      console.log(`🛑 Blocked at call ${i}`);
      console.log(`   Reason: ${error.guardResult?.reason}`);
      console.log(`   Total spent before block: $${totalSpent.toFixed(2)}`);
      console.log(`   Would have spent: $${error.guardResult?.blockedCost?.toFixed(2)}`);
      break;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('CostGuard prevented:');
  console.log('  • Runaway loops (>50 steps)');
  console.log('  • Duplicate calls (>3 identical)');
  console.log('  • Cost explosions (>$10/session)');
  console.log('\nIntegration: 1 line of code');
  console.log('Latency: <5ms per call');
  console.log('Infrastructure: None required');
}

runExample().catch(console.error);
