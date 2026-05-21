import { guard } from "../src";

const fakeClient = {
  chat: {
    completions: {
      create: async () => "ok"
    }
  }
};

const guarded = guard(fakeClient, { budget: 5 });

async function run() {
  const res = await guarded.chat.completions.create({
    model: "gpt-test",
    messages: [{ role: "user", content: "hello" }]
  });

  console.log(res);
}

run();
