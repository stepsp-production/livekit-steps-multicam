import express from "express";
import compression from "compression";
import cors from "cors";
import morgan from "morgan";
import { Readable } from "node:stream";
import { Agent } from "undici";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const app = express();
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(cors());
app.use(morgan("tiny"));

const PORT = process.env.PORT || 10000;

// ---------- ENV ----------
const LIVEKIT_API_KEY   = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET= process.env.LIVEKIT_API_SECRET || "";
const LIVEKIT_WS_URL    = process.env.LIVEKIT_WS_URL || "";    // wss://....livekit.cloud
const LIVEKIT_HOST      = process.env.LIVEKIT_HOST || "";      // https://....livekit.cloud
const SETUP_ADMIN_KEY   = process.env.SETUP_ADMIN_KEY || "";

const ORIGIN_BASE       = (process.env.ORIGIN_BASE || "").replace(/\/+$/,"");
const UPSTREAM_PREFIX   = (process.env.UPSTREAM_PREFIX ?? "/hls").replace(/\/+$/,"");
const ALLOW_INSECURE_TLS= String(process.env.ALLOW_INSECURE_TLS || "false")==="true";

const dispatcher = ALLOW_INSECURE_TLS ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;

// Health
app.get("/healthz", (req,res)=>res.json({ ok:true }));

// ---------- /api/livekit-token ----------
app.all("/api/livekit-token", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_WS_URL) {
      return res.status(500).json({ error: "Server not configured" });
    }
    const src = req.method === "POST" ? req.body : req.query;
    const room      = (src.room || "").toString().trim();
    const identity  = (src.identity || "").toString().trim();
    const name      = (src.name || "").toString().trim();
    const canPublish   = src.canPublish   !== "false" && src.canPublish   !== false;
    const canSubscribe = src.canSubscribe !== "false" && src.canSubscribe !== false;

    if (!room) return res.status(400).json({ error: "room is required" });

    const userId = identity || `u_${Math.random().toString(36).slice(2,10)}`;

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: userId,
      name: name || userId,
      ttl: 60 * 60,
    });
    at.addGrant({
      roomJoin: true,
      room,
      canPublish,
      canSubscribe,
      canPublishData: true,
    });
    const token = await at.toJwt();
    res.json({ token, wsUrl: LIVEKIT_WS_URL, identity: userId, room });
  } catch (e) {
    console.error("livekit-token error", e);
    res.status(500).json({ error: "internal_error" });
  }
});

// ---------- /api/create-rooms ----------
app.get("/api/create-rooms", async (req, res) => {
  try {
    if (!SETUP_ADMIN_KEY) return res.status(500).json({ error: "Missing SETUP_ADMIN_KEY" });
    if (!LIVEKIT_HOST || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return res.status(500).json({ error: "Missing LiveKit config" });
    }
    const providedKey = (req.query.key || "").toString().trim();
    if (providedKey !== SETUP_ADMIN_KEY) return res.status(401).json({ error: "unauthorized" });

    const svc = new RoomServiceClient(LIVEKIT_HOST, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const names = Array.from({ length: 10 }, (_, i) => `studio-${i+1}`);
    const results = [];

    for (const name of names) {
      try {
        let room = null;
        try { room = await svc.getRoom(name); } catch (_) {}
        if (!room) {
          room = await svc.createRoom({
            name,
            maxParticipants: 32,
            emptyTimeout: 60 * 30,
            e2ee: false
          });
          results.push({ name, created: true });
        } else {
          results.push({ name, created: false });
        }
      } catch (e) {
        results.push({ name, error: true, message: String(e && e.message || e) });
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    console.error("create-rooms error", e);
    res.status(500).json({ error: "internal_error" });
  }
});

// ---------- /api/hls/* proxy ----------
function isM3U8(p){ return /\.m3u8(\?.*)?$/i.test(p); }
function parentDir(p){ return p.replace(/\/[^/]*$/, "/"); }
function rewriteManifest(text, publicBase){
  const root = "/api/hls";
  const parent = parentDir(publicBase);
  return text.split("\n").map((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return line;
    if (/^https?:\/\//i.test(t)) {
      try { const u = new URL(t); return `${root}${u.pathname}${u.search || ""}`; } catch { return line; }
    }
    return parent + t;
  }).join("\n");
}

app.all(/^\/api\/hls(\/.*)?$/i, async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!ORIGIN_BASE) return res.status(500).end("Missing ORIGIN_BASE");

  try {
    const match = req.url.match(/\/api\/hls(\/[^?]*)/i);
    const subPath = match ? match[1] : "/";
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";

    const upstreamPath = `${UPSTREAM_PREFIX}${subPath}`.replace(/\/{2,}/g, "/");
    const upstreamUrl  = `${ORIGIN_BASE}${upstreamPath}${qs}`;

    const fwdHeaders = {};
    for (const h of ["range","user-agent","accept","accept-encoding","origin","referer"]) {
      if (req.headers[h]) fwdHeaders[h] = req.headers[h];
    }

    const up = await fetch(upstreamUrl, { method: "GET", headers: fwdHeaders, dispatcher });

    res.status(up.status);
    up.headers.forEach((v, k) => {
      if (k.toLowerCase() === "transfer-encoding") return;
      res.setHeader(k, v);
    });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Upstream-URL", upstreamUrl);

    if (!up.ok) {
      if (up.body) try { await up.arrayBuffer(); } catch {}
      return res.end();
    }

    const publicBase = `/api/hls${subPath}${qs}`;
    if (isM3U8(subPath)) {
      const text = await up.text();
      const rewritten = rewriteManifest(text, publicBase);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      return res.end(rewritten);
    }

    if (up.body) { Readable.fromWeb(up.body).pipe(res); } else { res.end(); }
  } catch (e) {
    console.error("HLS proxy error", e);
    res.status(500).end("Proxy error");
  }
});

app.listen(PORT, () => {
  console.log("server listening on", PORT);
});
