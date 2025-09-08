// api/hls/[...path].js
const { Readable } = require('node:stream');

const ORIGIN_BASE = (process.env.ORIGIN_BASE || '').replace(/\/+$/, '');

function isM3U8(path) {
  return /\.m3u8(\?.*)?$/i.test(path);
}

function publicPathFromApi(url) {
  // /api/hls/live/playlist.m3u8 -> /hls/live/playlist.m3u8
  return url.replace(/^\/api/, '');
}

function parentDir(p) {
  return p.replace(/\/[^/]*$/, '/');
}

function rootOfPublic(p) {
  // /hls/live/playlist.m3u8 -> /hls
  const parts = p.split('/');
  return '/' + (parts[1] || 'hls');
}

function rewriteManifest(text, publicBase) {
  const pubRoot = rootOfPublic(publicBase);
  const parent  = parentDir(publicBase);

  return text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;

      // مطلق http/https -> نعيد توجيهه عبر /hls
      if (/^https?:\/\//i.test(t)) {
        try {
          const u = new URL(t);
          return `${pubRoot}${u.pathname}${u.search || ''}`;
        } catch {
          return line;
        }
      }

      // نسبي -> نلحقه على نفس المجلد
      return parent + t;
    })
    .join('\n');
}

module.exports = async (req, res) => {
  try {
    if (!ORIGIN_BASE) {
      res.status(500).send('Missing ORIGIN_BASE env');
      return;
    }

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    const parts = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
    const hlsPath = '/' + parts.join('/');
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const upstreamUrl = `${ORIGIN_BASE}${hlsPath}${qs}`;

    // مرر بعض الهيدر (خاصة Range)
    const fwdHeaders = {};
    for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
      if (req.headers[h]) fwdHeaders[h] = req.headers[h];
    }

    const up = await fetch(upstreamUrl, { method: 'GET', headers: fwdHeaders });

    // مرّر هيدرز مهمة
    res.status(up.status);
    up.headers.forEach((v, k) => {
      if (k.toLowerCase() === 'transfer-encoding') return;
      res.setHeader(k, v);
    });
    res.setHeader('Cache-Control', 'no-store');

    // 4xx/5xx
    if (!up.ok) {
      // استهلك البدي وأغلق
      if (up.body) {
        try { await up.arrayBuffer(); } catch {}
      }
      res.end();
      return;
    }

    const publicBase = publicPathFromApi(req.url);

    // إعادة كتابة المانيفست
    if (isM3U8(hlsPath)) {
      const text = await up.text();
      const rewritten = rewriteManifest(text, publicBase);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.end(rewritten);
      return;
    }

    // مقاطع (ts/m4s …) -> تيار ثنائي
    if (up.body) {
      Readable.fromWeb(up.body).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    console.error('HLS proxy error', e);
    res.status(500).end('Proxy error');
  }
};
