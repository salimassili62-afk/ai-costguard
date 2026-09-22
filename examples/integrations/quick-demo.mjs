import { guard, GuardError } from '../../dist/index.js';

let providerCalls = 0;
const events = [];

const mockProvider = {
  chat: {
    completions: {
      create: async (request) => {
        providerCalls += 1;
        return {
          choices: [{ message: { content: `mock response for ${request.model}` } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        };
      },
    },
  },
};

const client = guard(mockProvider, {
  budget: 0.00025,
  behaviorAnalysis: false,
});

client.on('block', (event) => {
  events.push({ type: event.type, code: event.code, reason: event.reason });
});

for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: `unique demo request ${attempt}` }],
      max_tokens: 200,
    });
    console.log(`Attempt ${attempt}: ALLOW`);
  } catch (error) {
    if (!(error instanceof GuardError)) throw error;
    console.log(`Attempt ${attempt}: BLOCK ${error.code}`);
  }
}

console.log(`Provider calls: ${providerCalls}`);
console.log(`Blocked provider calls: ${events.length}`);
console.log(JSON.stringify(events, null, 2));