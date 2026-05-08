import { withCostGuard } from "../src";

const fakeClient = {
  chat: {
    completions: {
      create: async () => "ok"
    }
  }
};

const guarded = withCostGuard(fakeClient, {
  maxTotalCostPerDay: 5
});

async function run() {
  const res = await guarded.chat.completions.create({
    model: "gpt-test",
    messages: [{ role: "user", content: "hello" }]
  });

  console.log(res);
}

run();