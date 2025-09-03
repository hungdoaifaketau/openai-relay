import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json({ limit: "1mb" }));

// CORS: chỉ cho phép domain/app của bạn (sửa lại origin nếu cần)
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  allowedHeaders: ["Content-Type", "X-Relay-Key"],
  methods: ["POST", "OPTIONS"]
}));

// Bảo vệ relay bằng một key riêng (đặt ở biến môi trường RELAY_KEY)
const RELAY_KEY = process.env.RELAY_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

app.post("/responses", async (req, res) => {
  try {
    if (!RELAY_KEY || !OPENAI_KEY) {
      return res.status(500).json({ ok: false, error: "missing_relay_or_openai_key" });
    }
    if (req.get("X-Relay-Key") !== RELAY_KEY) {
      return res.status(401).json({ ok: false, error: "invalid_relay_key" });
    }

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body)
    });

    const text = await r.text();
    res.status(r.status).type("application/json").send(text);
  } catch (e) {
    res.status(502).json({ ok: false, error: "relay_upstream_error", detail: String(e) });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), service: "openai-relay" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Relay listening on", port));
