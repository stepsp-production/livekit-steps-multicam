export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,HEAD',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (path.startsWith('/api/hls')) {
      const targetBase = env.HLS_FORWARD || 'https://hls-proxy.it-f2c.workers.dev';
      const forwardTo = new URL(targetBase);
      forwardTo.pathname = path.replace(/^\/api\/hls/, '');
      forwardTo.search = url.search;
      const resp = await fetch(forwardTo.toString(), req);
      const hdrs = new Headers(resp.headers);
      Object.entries(corsHeaders).forEach(([k,v])=>hdrs.set(k,v));
      return new Response(resp.body, { status: resp.status, headers: hdrs });
    }

    if (path.startsWith('/api/')) {
      const base = env.API_BASE;
      if (!base) return new Response('Missing API_BASE', { status: 500 });

      const target = new URL(base);
      target.pathname = path;
      target.search = url.search;

      const newHeaders = new Headers();
      for (const [k, v] of req.headers.entries()) {
        const lk = k.toLowerCase();
        if (lk === 'host' || lk.startsWith('cf-') || lk === 'content-length') continue;
        newHeaders.set(k, v);
      }

      const init = {
        method: req.method,
        headers: newHeaders,
        body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : await req.arrayBuffer()
      };

      const resp = await fetch(target.toString(), init);
      const hdrs = new Headers(resp.headers);
      Object.entries(corsHeaders).forEach(([k,v])=>hdrs.set(k,v));
      return new Response(resp.body, { status: resp.status, headers: hdrs });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};
