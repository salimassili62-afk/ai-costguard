const OpenAI = require("openai");
const { withFirewall } = require("./dist/middleware/withFirewall");

// 👇 client حقيقي (حتى لو API key غلط)
const client = new OpenAI({
  apiKey: "fake-key"
});

// 👇 فعل debug
const safeAI = withFirewall(client, {
  debug: true,
  trustMode: "block",
  onBlock: (reason) => {
    console.log("🔥 BLOCKED:", reason);
  }
});

(async () => {
  try {
    console.log("🚀 BEFORE CALL");

    await safeAI.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }]
    });

  } catch (err) {
    console.log("❌ ERROR:", err.message || err);
  }
})();