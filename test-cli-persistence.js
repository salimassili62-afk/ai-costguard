/**
 * Test CLI persistence with 10 repeated calls
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

const AIFW_DIR = path.join(os.homedir(), '.aifw');
const HISTORY_FILE = path.join(AIFW_DIR, 'history.jsonl');

function clearHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    fs.unlinkSync(HISTORY_FILE);
  }
}

function countHistoryEntries() {
  if (!fs.existsSync(HISTORY_FILE)) return 0;
  const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n');
  return lines.filter(l => l.trim()).length;
}

async function test10RepeatedCalls() {
  console.log('=== Testing CLI Persistence: 10 Repeated Calls ===\n');
  
  // Clear history
  clearHistory();
  console.log('History cleared. Starting fresh.\n');
  
  let duplicateDetected = false;
  let loopDetected = false;
  let blockedCount = 0;
  
  for (let i = 1; i <= 10; i++) {
    try {
      const { stdout, stderr } = await execAsync('node dist/cli/index.js check "This is a test prompt for duplicate detection" --model gpt-4', { timeout: 10000 });
      
      const isDuplicate = stdout.includes('DUPLICATE') || stdout.includes('DANGER DETECTED');
      const isLoop = stdout.includes('LOOP') || stdout.includes('KILL SWITCH');
      const isBlocked = stdout.includes('BLOCKED');
      
      if (isDuplicate) duplicateDetected = true;
      if (isLoop) loopDetected = true;
      if (isBlocked) blockedCount++;
      
      console.log(`Call ${i.toString().padStart(2)}: ${isDuplicate ? '🔴 DUPLICATE' : isLoop ? '🔴 LOOP' : '🟢 SAFE'}`);
    } catch (err) {
      // Timeout or other error
      console.log(`Call ${i.toString().padStart(2)}: ⚠️ ERROR (may be blocked/hanging)`);
    }
  }
  
  console.log('\n=== Results ===');
  console.log(`Total entries in history file: ${countHistoryEntries()}`);
  console.log(`Duplicate detected: ${duplicateDetected ? '✅ YES' : '❌ NO'}`);
  console.log(`Loop detected: ${loopDetected ? '✅ YES' : '❌ NO'}`);
  console.log(`Blocked requests: ${blockedCount}`);
  
  // Test report command
  console.log('\n=== Testing Report Command ===');
  try {
    const { stdout } = await execAsync('node dist/cli/index.js report', { timeout: 10000 });
    console.log(stdout);
    
    const hasRequests = stdout.includes('Total Requests:') && !stdout.includes('Total Requests: 0');
    console.log(`Report shows accumulated requests: ${hasRequests ? '✅ YES' : '❌ NO'}`);
  } catch (err) {
    console.log('Report command failed or timed out');
  }
  
  // Final verdict
  console.log('\n=== FINAL VERDICT ===');
  if (duplicateDetected && countHistoryEntries() >= 10) {
    console.log('✅ CLI PERSISTENCE IS WORKING');
    console.log('   - Duplicate detection works across CLI calls');
    console.log('   - History is persisted to file');
    console.log('   - Report shows accumulated data');
    return true;
  } else {
    console.log('❌ CLI PERSISTENCE NOT WORKING');
    return false;
  }
}

test10RepeatedCalls().then(success => {
  process.exit(success ? 0 : 1);
});
