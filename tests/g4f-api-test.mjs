#!/usr/bin/env node
/**
 * Test G4F API (used by default for mistake analysis).
 * Run: node tests/g4f-api-test.mjs
 */

const G4F_CHAT_URL = "https://g4f.space/api/pollinations/v1/chat/completions";
const MODEL = "openai-large";

async function testG4F() {
  console.log("Testing G4F API at", G4F_CHAT_URL, "model:", MODEL);
  const body = {
    model: MODEL,
    temperature: 0.3,
    messages: [
      { role: "user", content: "Reply with exactly: TAGS: test-tag\nThen one short sentence." },
    ],
  };
  try {
    const res = await fetch(G4F_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("G4F API error", res.status, text);
      process.exit(1);
    }
    const data = JSON.parse(text);
    const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || "";
    console.log("G4F response OK. Content preview:", content.slice(0, 200));
    if (content.includes("TAGS:")) {
      console.log("TAGS line present – parse logic will work.");
    }
    console.log("G4F test passed.");
  } catch (e) {
    console.error("G4F test failed:", e.message);
    process.exit(1);
  }
}

testG4F();
