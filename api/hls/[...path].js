// api/hls/[...path].js
const { Readable } = require('node:stream');
const { Agent } = require('undici');

const ORIGIN_BASE = (process.env.ORIGIN_BASE || '').replace(/\/+$/, '');
const ALLOW_INSECURE_TLS = String(process.env.ALLOW_INSECURE_TLS || 'false') === 'true';

// في حال شهادة غير صالحة نقدر (اختبارياً) نتجاوز التحقق
const dispatcher = ALLOW_INSECURE_TLS
  ? new Agent({ connect: { rejectUnauthorized: false } })
  : undefined;

function isM3U8(p) { return /\.m3u8(\?.*)?$/i.test(p); }
function parentDir(p) { return p.replace(/\/[^/]*$/, '/'); }
// استخراج الجذر الحالي للبروكسي: /api/hls
function currentProxyRoot(p) {
  const m = p.match(/^\/[^/]+\/[^/]+/);
  return m ? m[0] : '/api/hls';
}

function rewriteManifest(text, publicBase) {
  const root = currentProxyRoot(publicBase);   // مثال: /api/hls
  const parent = parentDir(publicBase);        // مثال: /api/hls/live/

  return text.split('\n').map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;

    // روابط مطلقة -> نحولها عبر البروكسي
    if (/^https?:\/\//i.test(t)) {
      try {
        const u = new URL(t);
        return `${root}${u.pathname}${u.search || ''}`;
      } catch { return line; }
    }
    // روابط نسبية -> على نفس المجلد
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

    const parts = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
    const hlsPath = '/' + parts.join('/');
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const upstreamUrl = `${ORIGIN_BASE}${hlsPath}${qs}`;

    // مرّر بعض الهيدرز المهمة (خصوصًا Range)
    const fwdHeaders = {};
    for (const h of ['range','user-agent','accept','accept-encoding','origin','referer']) {
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

    // سنعيد كتابة المانيفست ليتبع /api/hls (لا نحتاج vercel.json)
    const publicBase = req.url; // مثال: /api/hls/live/playlist.m3u8
    if (isM3U8(hlsPath)) {
      const text = await up.text();
      const rewritten = rewriteManifest(text, publicBase.replace(/^\/api/, '/api'));
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
