// server.mjs — openai-relay: health OK + /api/ai-faq + /api/chat (Chat Completions)
// Safe for Render/Node 18+ (no AbortSignal.timeout), robust CORS & errors.

import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

/* ---------- ENV ---------- */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const RELAY_KEY      = process.env.RELAY_KEY || "";      // bắt buộc nếu bạn muốn khóa
const MODEL_DEFAULT  = process.env.MODEL_DEFAULT || "gpt-4o-mini";
const TIMEOUT_AI_MS  = Number(process.env.TIMEOUT_AI || 25000);

// ALLOWED_ORIGINS: ví dụ "https://your-frontend.com,https://other.com" hoặc "*"
const ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

/* ---------- Helpers ---------- */
function isAllowedOrigin(origin = "") {
  if (!origin) return ORIGINS.includes("*"); // nếu không có Origin header, cho qua khi dùng *
  return ORIGINS.includes("*") || ORIGINS.includes(origin);
}

// fetch with timeout (không dùng AbortSignal.timeout để tránh crash trên Node cũ)
async function fetchWithTimeout(url, opts = {}, timeoutMs = TIMEOUT_AI_MS) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

function ensureAuth(req, res) {
  if (!RELAY_KEY) {
    res.status(500).json({ error: "Missing RELAY_KEY (server config)" });
    return false;
  }
  if ((req.headers["x-relay-key"] || "") !== RELAY_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    return false;
  }
  return true;
}

/* ---------- CORS (đặt TRƯỚC MỌI ROUTE) ---------- */
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allowed = isAllowedOrigin(origin);

  // để proxy/CDN cache theo Origin
  res.setHeader("Vary", "Origin");

  // Nếu cho phép *, trả *; nếu không, trả đúng origin gọi tới
  res.setHeader("Access-Control-Allow-Origin", ORIGINS.includes("*") ? "*" : (allowed ? origin : ""));
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-relay-key");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    // Preflight: trả 204 nếu allowed, 403 nếu không
    return res.sendStatus(allowed ? 204 : 403);
  }

  if (origin && !allowed) {
    return res.status(403).json({ error: "CORS origin not allowed" });
  }
  next();
});

/* ---------- Friendly endpoints ---------- */
app.get("/", (_req, res) => res.type("text/plain").send("openai-relay is running"));
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get("/api/chat", (_req, res) => {
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

/* ---------- /api/ai-faq ---------- */
app.post("/api/ai-faq", async (req, res) => {
  try {
    if (!ensureAuth(req, res)) return;

    const { question, model } = req.body || {};
    const usedModel = model || MODEL_DEFAULT;

    const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
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
      })
    }, TIMEOUT_AI_MS);

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/* ---------- /api/chat (Chat Completions, non-stream) ---------- */
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

    const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body)
    }, TIMEOUT_AI_MS);

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/* ---------- Start ---------- */
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => console.log(`Relay listening on ${PORT}`));
