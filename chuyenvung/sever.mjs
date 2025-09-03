// server.mjs — openai-relay: health OK + /api/ai-faq + /api/chat (Chat Completions-style)
import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

/* ---------- CORS ---------- */
const ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());
app.use((req, res, next) => {
  const origin = req.headers.origin || "*";
  const allowOrigin =
    ORIGINS.includes("*") || ORIGINS.includes(origin) ? origin : (ORIGINS[0] || "*");

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-relay-key");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

/* ---------- Base routes ---------- */
app.get("/", (req, res) => res.type("text/plain").send("openai-relay is running"));
app.get("/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

/* ---------- ENV ---------- */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const RELAY_KEY      = process.env.RELAY_KEY || "";
const MODEL_DEFAULT  = process.env.MODEL_DEFAULT || "gpt-4o-mini";
const TIMEOUT_AI     = +(process.env.TIMEOUT_AI || 25000);

/* ---------- Helpers ---------- */
function ensureAuth(req, res) {
  if (!RELAY_KEY || (req.headers["x-relay-key"] || "") !== RELAY_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    return false;
  }
  return true;
}

/* ---------- Demo FAQ (giữ lại cho bạn đang dùng) ---------- */
app.post("/api/ai-faq", async (req, res) => {
  try {
    if (!ensureAuth(req, res)) return;

    const { question, model } = req.body || {};
    const usedModel = model || MODEL_DEFAULT;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: usedModel,
        messages: [
          { role: "system", content: "You are a concise, helpful cybersecurity assistant for anti-scam FAQs." },
          { role: "user", content: question || "Hướng dẫn an toàn tài khoản ngân hàng?" }
        ],
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(TIMEOUT_AI)
    });

    const data = await r.json().catch(() => ({}));
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/* ---------- NEW: /api/chat (giống Chat Completions, non-stream) ---------- */
app.post("/api/chat", async (req, res) => {
  try {
    if (!ensureAuth(req, res)) return;

    const {
      model = MODEL_DEFAULT,
      messages = [],
      temperature = 0.7,
      max_tokens,
      top_p,
      presence_penalty,
      frequency_penalty,
      stop
    } = req.body || {};

    const body = {
      model,
      messages,
      temperature,
      ...(max_tokens !== undefined ? { max_tokens } : {}),
      ...(top_p !== undefined ? { top_p } : {}),
      ...(presence_penalty !== undefined ? { presence_penalty } : {}),
      ...(frequency_penalty !== undefined ? { frequency_penalty } : {}),
      ...(stop !== undefined ? { stop } : {})
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_AI)
    });

    // Trả nguyên định dạng OpenAI cho dễ tích hợp
    const data = await r.json().catch(() => ({}));
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/* ---------- Start ---------- */
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => console.log(`Relay listening on ${PORT}`));
// Cho preflight CORS trả về ngay
app.options("/api/chat", (req, res) => res.sendStatus(204));

// Mô tả cách dùng khi ai đó mở GET trên trình duyệt
app.get("/api/chat", (req, res) => {
  res.status(405).json({
    ok: true,
    note: "Use POST with JSON and X-Relay-Key",
    example: {
      url: "/api/chat",
      method: "POST",
      headers: { "content-type": "application/json", "X-Relay-Key": "<your-relay-key>" },
      body: {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", "content": "You are a helpful assistant." },
          { role: "user", "content": "phishing là gì?" }
        ],
        temperature: 0.2
      }
    }
  });
});

