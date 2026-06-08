import { guard } from "./dist/index.js";

const fakeAI = {
  chat: {
    completions: {
      create: async () => {
        return {
          choices: [
            {
              message: {
                content: "retry"
              }
            }
          ]
        };
      }
    }
  }
};

const ai = guard(fakeAI, { budget: 1 });

let count = 0;

async function run() {
  while (true) {
    count++;

    try {
      const res = await ai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "user", content: "retry again and again" }
        ]
      });

      console.log(count, res.choices[0].message.content);

    } catch (err) {
      console.log("\n🛑 KILL SWITCH TRIGGERED");
      console.log(err.message);
      process.exit(0);
    }
  }
}

run();