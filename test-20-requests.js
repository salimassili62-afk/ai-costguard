/**
 * Simulation: 20 repeated requests to confirm blocking
 */

const { sharedState } = require('./dist/core/SharedState');

async function simulate20Requests() {
  console.log('\n=== Simulating 20 Repeated Identical Requests ===\n');
  
  // Reset state
  sharedState.reset();
  const detector = sharedState.getWasteDetector();
  
  const model = 'gpt-4';
  const prompt = 'Generate a summary of this document';
  const cost = 0.05; // $0.05 per request
  
  let safeCount = 0;
  let blockedCount = 0;
  let totalDangerScore = 0;
  let loopTriggers = 0;
  let duplicateTriggers = 0;
  
  for (let i = 1; i <= 20; i++) {
    const result = detector.detect(model, prompt, cost, undefined, 'block', false);
    
    if (result.isDangerous) {
      blockedCount++;
      totalDangerScore += result.dangerScore;
      
      if (result.category === 'loop') loopTriggers++;
      if (result.category === 'duplicate') duplicateTriggers++;
      
      console.log(`Request ${i.toString().padStart(2)}: 🔴 BLOCKED (${result.category}) - Score: ${result.dangerScore}`);
    } else {
      safeCount++;
      console.log(`Request ${i.toString().padStart(2)}: 🟢 SAFE`);
    }
  }
  
  console.log('\n=== RESULTS ===');
  console.log(`Total Requests: 20`);
  console.log(`Safe: ${safeCount}`);
  console.log(`Blocked: ${blockedCount}`);
  console.log(`Loop Triggers: ${loopTriggers}`);
  console.log(`Duplicate Triggers: ${duplicateTriggers}`);
  console.log(`Average Danger Score (blocked): ${blockedCount > 0 ? (totalDangerScore / blockedCount).toFixed(1) : 0}`);
  
  // Calculate potential savings
  const potentialLoss = blockedCount * cost;
  console.log(`\n💰 Potential Loss Prevented: $${potentialLoss.toFixed(2)}`);
  
  if (blockedCount >= 18) {
    console.log('\n✅ SUCCESS: System correctly blocked repeated requests!');
    return true;
  } else {
    console.log('\n❌ FAIL: System did not block enough requests');
    return false;
  }
}

simulate20Requests().then(success => {
  process.exit(success ? 0 : 1);
});
