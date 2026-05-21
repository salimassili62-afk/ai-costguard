import { guard } from '@salimassili/ai-costguard';

const fakeClient = {
  chat: {
    completions: {
      create: async () => ({ ok: true })
    }
  }
};

const wrapped = guard(fakeClient, { budget: 10 });

const res = await wrapped.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "hello" }]
});

console.log("RESULT:", res);
