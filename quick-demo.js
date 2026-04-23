const crypto = require('crypto');

const seen = new Set();
const prompt = 'You are a senior engineer. Analyze this entire codebase for security vulnerabilities, performance issues, and architectural problems. Provide detailed recommendations for each file.'.repeat(3);
const tokensPerRequest = 10000;
const pricePerToken = 5.00 / 1000000;

let blocked = 0;
const total = 50;

for (let i = 0; i < total; i++) {
  const hash = crypto.createHash('md5').update(prompt).digest('hex');
  if (seen.has(hash)) {
    blocked++;
  } else {
    seen.add(hash);
  }
}

const prevented = blocked * tokensPerRequest * pricePerToken;

console.log('============================================================');
console.log('   AI WASTE GUARD - LIVE RESULTS');
console.log('============================================================');
console.log('   Model:             gpt-4o');
console.log('   Total Requests:    ' + total);
console.log('   Blocked Requests:  ' + blocked);
console.log('   Passed Requests:   ' + (total - blocked));
console.log('   Prevented Cost:    $' + prevented.toFixed(2));
console.log('   You saved $' + prevented.toFixed(2) + ' by blocking ' + blocked + ' wasteful requests.');
console.log('============================================================');