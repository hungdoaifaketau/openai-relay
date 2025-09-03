import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "1mb" }));

const ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",").map(s => s.trim());

app.use((req, res, next) => {
  const origin = req.headers.origin || "*";
  const allowOrigin = ORIGINS.includes("*") || ORIGINS.includes(origin)
    ? origin : ORIGINS[0] || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-relay-key");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

const MUST = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

const OPENAI_API_KEY = MUST("OPENAI_API_KEY");
const RELAY_KEY = MUST("RELAY_KEY");
const MODEL_DEFAULT = process.env.MODEL_DEFAULT || "gpt-4o-mini";
const TIMEOUT_AI = +(process.env.TIMEOUT_AI || 25000);

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/ai-faq", async (req, res) => {
  try {
    if ((req.headers["x-relay-key"] || "") !== RELAY_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { question, model } = req.body || {};
    const usedModel = model || MODEL_DEFAULT;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: usedModel,
        messages: [
          { role: "system", content: "You are a concise, helpful cybersecurity assistant for anti-scam FAQs." },
          { role: "user", content: question || "Hướng dẫn an toàn tài khoản ngân hàng?" }
        ],
        temperature: 0.3
      }),
      timeout: TIMEOUT_AI
    });

    const data = await r.json();
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

const PORT = process.env.PORT || 7860;
app.listen(PORT, () => console.log(`Relay listening on ${PORT}`));
