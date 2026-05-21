import { guard, GuardError } from "./dist/index.js";

const fakeAI = {
  chat: {
    completions: {
      create: async () => ({ ok: true }),
    },
  },
};

const safeAI = guard(fakeAI, { budget: 0.001 });

try {
  console.log("BEFORE CALL");

  await safeAI.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: "Hello" }],
    max_tokens: 1000,
  });
} catch (err) {
  if (err instanceof GuardError) {
    console.log("BLOCKED:", err.message);
  } else {
    console.log("ERROR:", err.message || err);
  }
}
