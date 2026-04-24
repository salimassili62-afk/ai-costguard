/**
 * Manual test script to verify detection works in real scenarios
 */

const { sharedState } = require('./dist/core/SharedState');

async function testDuplicateDetection() {
  console.log('\n=== Testing Duplicate Detection ===');
  
  // Reset state
  sharedState.reset();
  const detector = sharedState.getWasteDetector();
  
  const model = 'gpt-4';
  const prompt = 'This is a test prompt for duplicate detection';
  const cost = 0.01;
  
  let blockedCount = 0;
  let dangerousCount = 0;
  
  for (let i = 0; i < 10; i++) {
    const result = detector.detect(model, prompt, cost, undefined, 'block', false);
    
    if (result.isDangerous) {
      dangerousCount++;
      console.log(`Request ${i + 1}: ${result.category} - Score: ${result.dangerScore} - Action: ${result.action}`);
      if (result.action === 'block') {
        blockedCount++;
      }
    } else {
      console.log(`Request ${i + 1}: SAFE`);
    }
  }
  
  console.log(`\nResults: ${dangerousCount}/10 dangerous, ${blockedCount}/10 blocked`);
  
  if (dangerousCount === 0) {
    console.log('❌ FAIL: Duplicate detection not triggering!');
    return false;
  } else {
    console.log('✅ PASS: Duplicate detection is working');
    return true;
  }
}

async function testCostSpike() {
  console.log('\n=== Testing Cost Spike Detection ===');
  
  sharedState.reset();
  const detector = sharedState.getWasteDetector();
  
  const model = 'gpt-4';
  const prompt = 'Short prompt';
  const highCost = 1.50; // $1.50 should trigger
  
  const result = detector.detect(model, prompt, highCost, undefined, 'block', false);
  
  console.log(`High cost ($1.50): ${result.isDangerous ? 'DANGEROUS' : 'SAFE'} - Category: ${result.category} - Score: ${result.dangerScore}`);
  
  if (!result.isDangerous || result.category !== 'spike') {
    console.log('❌ FAIL: Cost spike detection not triggering!');
    return false;
  } else {
    console.log('✅ PASS: Cost spike detection is working');
    return true;
  }
}

async function testContextExplosion() {
  console.log('\n=== Testing Context Explosion Detection ===');
  
  sharedState.reset();
  const detector = sharedState.getWasteDetector();
  
  const model = 'gpt-4';
  const prompt = 'Short';
  const context = 'x'.repeat(5000); // 5k char context vs 5 char prompt = 1000x ratio
  const cost = 0.1;
  
  const result = detector.detect(model, prompt, cost, context, 'block', false);
  
  console.log(`Context ratio ~1000x: ${result.isDangerous ? 'DANGEROUS' : 'SAFE'} - Category: ${result.category} - Score: ${result.dangerScore}`);
  
  if (!result.isDangerous || result.category !== 'context') {
    console.log('❌ FAIL: Context explosion detection not triggering!');
    return false;
  } else {
    console.log('✅ PASS: Context explosion detection is working');
    return true;
  }
}

async function testFuzzyDuplicate() {
  console.log('\n=== Testing Fuzzy Duplicate Detection ===');
  
  sharedState.reset();
  const detector = sharedState.getWasteDetector();
  
  const model = 'gpt-4';
  const prompt1 = 'What is the weather today?';
  const prompt2 = 'What is the weather today?'; // identical
  const prompt3 = 'What is the weather like today?'; // 85%+ similar
  const cost = 0.01;
  
  // First request
  const result1 = detector.detect(model, prompt1, cost, undefined, 'block', false);
  console.log(`Request 1 (original): ${result1.isDangerous ? 'DANGEROUS' : 'SAFE'}`);
  
  // Second identical
  const result2 = detector.detect(model, prompt2, cost, undefined, 'block', false);
  console.log(`Request 2 (identical): ${result2.isDangerous ? 'DANGEROUS' : 'SAFE'} - Category: ${result2.category}`);
  
  // Third similar
  const result3 = detector.detect(model, prompt3, cost, undefined, 'block', false);
  console.log(`Request 3 (similar): ${result3.isDangerous ? 'DANGEROUS' : 'SAFE'} - Category: ${result3.category}`);
  
  if (!result3.isDangerous || result3.category !== 'fuzzy_duplicate') {
    console.log('❌ FAIL: Fuzzy duplicate detection not triggering!');
    return false;
  } else {
    console.log('✅ PASS: Fuzzy duplicate detection is working');
    return true;
  }
}

async function runAllTests() {
  console.log('Starting manual detection tests...\n');
  
  const results = [];
  
  try {
    results.push(await testDuplicateDetection());
    results.push(await testCostSpike());
    results.push(await testContextExplosion());
    results.push(await testFuzzyDuplicate());
    
    const passed = results.filter(r => r).length;
    const total = results.length;
    
    console.log(`\n=== FINAL RESULTS ===`);
    console.log(`${passed}/${total} tests passed`);
    
    if (passed === total) {
      console.log('✅ All detection mechanisms are working correctly!');
      process.exit(0);
    } else {
      console.log('❌ Some detection mechanisms need fixes');
      process.exit(1);
    }
  } catch (err) {
    console.error('Error running tests:', err);
    process.exit(1);
  }
}

runAllTests();
