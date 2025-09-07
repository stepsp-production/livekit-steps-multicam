import express from "express";
import morgan from "morgan";
import compression from "compression";
import cors from "cors";
import https from "https";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { URL } from "url";

// ======= CONFIG =======
const ORIGIN_BASE = process.env.ORIGIN_BASE || "http://46.152.116.98";
const PORT = process.env.PORT || 10000;
const ALLOW_INSECURE_TLS = String(process.env.ALLOW_INSECURE_TLS || "true") === "true";
// ======================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(morgan("tiny"));
app.use(compression());
app.use(cors());

// Serve your front-end (public/index.html)
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (/\.(m3u8)$/i.test(req.path)) {
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  } else if (/\.(ts|m4s)$/i.test(req.path)) {
    res.setHeader("Content-Type", "video/mp2t");
  }
  next();
});

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: !ALLOW_INSECURE_TLS });

function requestOnce(urlStr, headers) {
  const u = new URL(urlStr);
  const isHttps = u.protocol === "https:";
  const client = isHttps ? https : http;
  const opts = { method: "GET", headers, agent: isHttps ? insecureHttpsAgent : undefined };
  return new Promise((resolve, reject) => {
    const req = client.request(urlStr, opts, (up) => resolve(up));
    req.on("error", reject);
    req.end();
  });
}

async function fetchWithRedirects(urlStr, headers, maxRedirects = 5) {
  let current = urlStr;
  for (let i = 0; i <= maxRedirects; i++) {
    const up = await requestOnce(current, headers);
    const sc = up.statusCode || 0;
    if (sc >= 300 && sc < 400 && up.headers.location) {
      const loc = up.headers.location;
      up.resume();
      current = new URL(loc, current).toString();
      continue;
    }
    return { up, finalUrl: current };
  }
  throw new Error("Too many redirects");
}

function rewriteManifest(text, basePath) {
  return text.split("\n").map((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return line;
    if (/^https?:\/\//i.test(t)) {
      try {
        const url = new URL(t);
        return `${basePath}${url.pathname}${url.search || ""}`;
      } catch { return line; }
    }
    const parent = basePath.replace(/\/[^/]*$/, "/");
    return parent + t;
  }).join("\n");
}

// Proxy HLS
app.get("/hls/*", async (req, res) => {
  try {
    const upstreamUrl = ORIGIN_BASE + req.originalUrl;
    const headers = {
      ...req.headers,
      host: new URL(ORIGIN_BASE).host,
      ...(req.headers.range ? { Range: req.headers.range } : {}),
    };

    const { up } = await fetchWithRedirects(upstreamUrl, headers);

    if (up.headers["content-type"]) res.set("Content-Type", up.headers["content-type"]);
    if (up.headers["content-length"]) res.set("Content-Length", up.headers["content-length"]);
    if (up.headers["accept-ranges"]) res.set("Accept-Ranges", up.headers["accept-ranges"]);
    if (up.headers["content-range"]) res.set("Content-Range", up.headers["content-range"]);

    if ((up.statusCode || 0) >= 400) {
      res.status(up.statusCode).end();
      up.resume();
      return;
    }

    if (/\.m3u8(\?.*)?$/i.test(req.path)) {
      let data = "";
      up.setEncoding("utf8");
      up.on("data", (c) => (data += c));
      up.on("end", () => {
        const rewritten = rewriteManifest(data, req.originalUrl);
        res.type("application/vnd.apple.mpegurl").send(rewritten);
      });
      up.on("error", () => res.status(502).send("Upstream error"));
      return;
    }

    res.status(up.statusCode || 200);
    up.pipe(res);
  } catch (e) {
    console.error(e);
    res.status(500).send("Proxy error");
  }
});

// Simple test player (optional)
app.get("/player", (req, res) => {
  const src = req.query.src || "/hls/live/playlist.m3u8";
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HLS Player</title>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<style>html,body{margin:0;background:#000} video{width:100vw;height:100vh;object-fit:contain}</style>
</head><body>
<video id="v" controls muted playsinline></video>
<script>
const v=document.getElementById('v'); const src=${JSON.stringify(src)};
if (window.Hls && Hls.isSupported()) { const h=new Hls(); h.loadSource(src); h.attachMedia(v); }
else { v.src=src; }
</script>
</body></html>`);
});

app.listen(PORT, () => {
  console.log("Server on", PORT, "→ origin:", ORIGIN_BASE, "insecureTLS:", ALLOW_INSECURE_TLS);
});
