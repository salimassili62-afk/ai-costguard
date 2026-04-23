/**
 * AI Waste Guard Demo - Simulation
 * 
 * This demo simulates 50 identical requests to show waste detection in action
 */

import { AIWasteGuard } from '../wrapper';

// Simulated AI API call (no real API calls)
async function mockOpenAICall(): Promise<any> {
  return {
    choices: [{ message: { content: 'This is a mock response' } }],
    usage: { total_tokens: 500, prompt_tokens: 400, completion_tokens: 100 },
  };
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  🛡️  AI WASTE GUARD - SIMULATION DEMO');
  console.log('='.repeat(60) + '\n');
  
  const guard = new AIWasteGuard();
  const model = 'gpt-4o';
  
  // Realistic prompt ~500 tokens
  const realisticPrompt = `Please analyze the following code snippet and provide a comprehensive review including:
1. Code quality assessment
2. Potential bugs or issues
3. Performance optimization suggestions
4. Security vulnerabilities
5. Best practices recommendations

The code implements a user authentication system with JWT tokens, password hashing using bcrypt,
and session management. It includes middleware for route protection, rate limiting, and input validation.
Please provide specific, actionable feedback with code examples where appropriate.`;
  
  const messages = [{ role: 'user', content: realisticPrompt }];
  
  console.log(`📊 Simulation Configuration:`);
  console.log(`   Model: ${model}`);
  console.log(`   Total Requests: 50`);
  console.log(`   Identical Prompt: ~500 tokens`);
  console.log(`   Expected Blocked: ~47 requests`);
  console.log('');
  
  console.log('⏳ Running simulation...\n');
  
  let passedCount = 0;
  let blockedCount = 0;
  
  // Send 50 identical requests
  for (let i = 1; i <= 50; i++) {
    const result = await guard.call(
      mockOpenAICall,
      { model, messages }
    );
    
    if (result.success) {
      passedCount++;
      if (i <= 3 || i === 50) {
        console.log(`   Request ${i}: ✅ PASSED`);
      }
    } else if (result.blocked) {
      blockedCount++;
      if (i <= 3 || i === 50) {
        console.log(`   Request ${i}: 🚫 BLOCKED (waste score: ${result.wasteScore}%)`);
      }
    }
    
    // Show progress every 10 requests
    if (i % 10 === 0) {
      console.log(`   ... Progress: ${i}/50 requests processed`);
    }
  }
  
  console.log('');
  console.log('='.repeat(60));
  console.log('  📈 SIMULATION RESULTS');
  console.log('='.repeat(60) + '\n');
  
  // Show statistics
  const stats = guard.getStats(24);
  
  console.log(`   Total Requests:      ${stats.totalRequests}`);
  console.log(`   Blocked Requests:    ${stats.blockedRequests}`);
  console.log(`   Passed Requests:     ${stats.totalRequests - stats.blockedRequests}`);
  console.log(`   Total Cost:          $${stats.totalCost.toFixed(4)}`);
  console.log(`   Prevented Cost:      $${stats.preventedCost.toFixed(4)}`);
  console.log('');
  
  // Calculate expected values
  const expectedBlocked = 47;
  const expectedCost = 2.34;
  const blockedMatch = stats.blockedRequests === expectedBlocked;
  const costMatch = Math.abs(stats.preventedCost - expectedCost) < 0.1;
  
  console.log('✅ Validation:');
  console.log(`   Blocked Requests Match: ${blockedMatch ? '✅' : '❌'} (expected: ${expectedBlocked}, actual: ${stats.blockedRequests})`);
  console.log(`   Prevented Cost Match:   ${costMatch ? '✅' : '❌'} (expected: ~$${expectedCost}, actual: $${stats.preventedCost.toFixed(2)})`);
  console.log('');
  
  if (blockedMatch && costMatch) {
    console.log('🎉 SUCCESS! Output matches expected values.\n');
  } else {
    console.log('⚠️  Note: Values may vary slightly based on waste detection thresholds.\n');
  }
  
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);
