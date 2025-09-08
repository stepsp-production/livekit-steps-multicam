// api/hls/[...path].js
const { Readable } = require('node:stream');

module.exports = async (req, res) => {
  // السماح للـ CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const base = (process.env.ORIGIN_BASE || '').replace(/\/+$/, '');
  if (!base) {
    res.status(500).send('Missing ORIGIN_BASE env');
    return;
  }

  // path catch-all
  const pathParts = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
  const path = pathParts.join('/');

  // احفظ الكويري كما هو
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

  const target = `${base}/${path}${qs}`;

  // مرّر بعض الهيدر المهم (خاصة Range)
  const fwdHeaders = {};
  for (const h of ['range', 'user-agent', 'accept', 'accept-encoding', 'origin', 'referer']) {
    if (req.headers[h]) fwdHeaders[h] = req.headers[h];
  }

  let upstream;
  try {
    upstream = await fetch(target, { method: 'GET', headers: fwdHeaders });
  } catch (e) {
    res.status(502).send('Upstream fetch failed');
    return;
  }

  res.status(upstream.status);
  upstream.headers.forEach((v, k) => {
    // اترك الترميز لـ Vercel
    if (k.toLowerCase() === 'transfer-encoding') return;
    res.setHeader(k, v);
  });

  // HLS يكون لايف؛ لا نريد تخزين
  res.setHeader('Cache-Control', 'no-store');

  if (!upstream.body) {
    res.end();
    return;
  }

  // web stream -> node stream
  Readable.fromWeb(upstream.body).pipe(res);
};
