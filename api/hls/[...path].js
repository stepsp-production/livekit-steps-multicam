// api/hls/[...path].js
// Proxy HLS with HTTPS support + manifest rewrite back to /api/hls
const { Readable } = require('node:stream');
const { Agent } = require('undici');

const ORIGIN_BASE = (process.env.ORIGIN_BASE || '').replace(/\/+$/, '');
// بعض السيرفرات تضع HLS تحت بادئة (غالباً /hls). اجعلها قابلة للتهيئة.
const UPSTREAM_PREFIX = (process.env.UPSTREAM_PREFIX ?? '/hls').replace(/\/+$/, '');
const ALLOW_INSECURE_TLS = String(process.env.ALLOW_INSECURE_TLS || 'false') === 'true';

const dispatcher = ALLOW_INSECURE_TLS ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;

function isM3U8(p) { return /\.m3u8(\?.*)?$/i.test(p); }
function parentDir(p) { return p.replace(/\/[^/]*$/, '/'); }

function rewriteManifest(text, publicBase) {
  const root = '/api/hls';                   // جذر البروكسي العام
  const parent = parentDir(publicBase);      // مجلد الملف الحالي تحت /api/hls/...

  return text.split('\n').map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;

    // روابط مطلقة → نعيد توجيهها عبر البروكسي
    if (/^https?:\/\//i.test(t)) {
      try {
        const u = new URL(t);
        return `${root}${u.pathname}${u.search || ''}`;
      } catch { return line; }
    }
    // روابط نسبية → على نفس المجلد
    return parent + t;
  }).join('\n');
}

module.exports = async (req, res) => {
  try {
    if (!ORIGIN_BASE) {
      res.status(500).end('Missing ORIGIN_BASE');
      return;
    }

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }

    // /api/hls/live/playlist.m3u8  → parts = ['live','playlist.m3u8']
    const parts = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
    const subPath = '/' + parts.join('/');                                   // /live/playlist.m3u8
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const upstreamPath = `${UPSTREAM_PREFIX}${subPath}`.replace(/\/{2,}/g, '/');   // /hls/live/playlist.m3u8
    const upstreamUrl = `${ORIGIN_BASE}${upstreamPath}${qs}`;

    // مرّر بعض الهيدرز المهمة (خصوصًا Range)
    const fwdHeaders = {};
    for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
      if (req.headers[h]) fwdHeaders[h] = req.headers[h];
    }

    const up = await fetch(upstreamUrl, { method: 'GET', headers: fwdHeaders, dispatcher });

    res.status(up.status);
    up.headers.forEach((v, k) => {
      if (k.toLowerCase() === 'transfer-encoding') return;
      res.setHeader(k, v);
    });
    res.setHeader('Cache-Control', 'no-store');

    if (!up.ok) { if (up.body) try { await up.arrayBuffer(); } catch {} res.end(); return; }

    // إعادة كتابة المانيفست ليعود عبر /api/hls (بدون vercel.json)
    const publicBase = `/api/hls${subPath}${qs}`;
    if (isM3U8(subPath)) {
      const text = await up.text();
      const rewritten = rewriteManifest(text, publicBase);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.end(rewritten);
      return;
    }

    if (up.body) { Readable.fromWeb(up.body).pipe(res); } else { res.end(); }
  } catch (e) {
    console.error('HLS proxy error', e);
    res.status(500).end('Proxy error');
  }
};
