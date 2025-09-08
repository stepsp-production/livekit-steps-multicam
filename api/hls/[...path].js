// api/hls/[...path].js
// HLS proxy with HTTPS support + manifest rewrite back to /api/hls
const { Readable } = require('node:stream');
const { Agent } = require('undici');

const ORIGIN_BASE = (process.env.ORIGIN_BASE || '').replace(/\/+$/, '');      // مثال: https://stream.example.com
const UPSTREAM_PREFIX = (process.env.UPSTREAM_PREFIX ?? '/hls').replace(/\/+$/, ''); // مثال: /hls أو / إن لم يكن هناك بادئة
const ALLOW_INSECURE_TLS = String(process.env.ALLOW_INSECURE_TLS || 'false') === 'true';

const dispatcher = ALLOW_INSECURE_TLS ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;

function isM3U8(p) { return /\.m3u8(\?.*)?$/i.test(p); }
function parentDir(p) { return p.replace(/\/[^/]*$/, '/'); }

function rewriteManifest(text, publicBase) {
  const root = '/api/hls';
  const parent = parentDir(publicBase);
  return text.split('\n').map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    // مطلق → أعد توجيهه عبر /api/hls
    if (/^https?:\/\//i.test(t)) {
      try {
        const u = new URL(t);
        return `${root}${u.pathname}${u.search || ''}`;
      } catch { return line; }
    }
    // نسبي → على نفس المجلد
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

    // استخرج المسار بعد /api/hls سواء من req.query أو من req.url احتياطاً
    let subPath = '';
    const q = req.query || {};
    if (q && q.path) {
      if (Array.isArray(q.path)) subPath = '/' + q.path.join('/');
      else subPath = '/' + String(q.path).replace(/^\/+/, '');
    } else {
      const m = req.url.match(/\/api\/hls(\/[^?]*)/i);
      subPath = m ? m[1] : '/';
    }
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

    const upstreamPath = `${UPSTREAM_PREFIX}${subPath}`.replace(/\/{2,}/g, '/'); // مثال: /hls/live/playlist.m3u8
    const upstreamUrl  = `${ORIGIN_BASE}${upstreamPath}${qs}`;

    // مرّر بعض الهيدرز المهمة
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
    res.setHeader('X-Upstream-URL', upstreamUrl); // للتشخيص

    if (!up.ok) {
      // لا نكسر HLS: نعيد نفس الحالة
      if (up.body) try { await up.arrayBuffer(); } catch {}
      res.end();
      return;
    }

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
