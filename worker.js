export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,HEAD',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization'
        }
      });
    }

    // Forward HLS to your HLS worker (optional)
    if (path.startsWith('/api/hls')) {
      const targetBase = env.HLS_FORWARD || 'https://hls-proxy.it-f2c.workers.dev';
      const forwardTo = new URL(targetBase);
      forwardTo.pathname = path.replace(/^\/api\/hls/, '');
      forwardTo.search = url.search;
      const resp = await fetch(forwardTo.toString(), req);
      const hdrs = new Headers(resp.headers);
      hdrs.set('Access-Control-Allow-Origin', '*');
      return new Response(resp.body, { status: resp.status, headers: hdrs });
    }

    // Forward other APIs to Render
    if (path.startsWith('/api/')) {
      const base = env.API_BASE; // ex: https://steps-livekit-api.onrender.com
      if (!base) return new Response('Missing API_BASE', { status: 500 });

      const target = new URL(base);
      target.pathname = path;
      target.search = url.search;

      const init = {
        method: req.method,
        headers: req.headers,
        body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : await req.arrayBuffer()
      };
      const resp = await fetch(target.toString(), init);
      const hdrs = new Headers(resp.headers);
      hdrs.set('Access-Control-Allow-Origin', '*');
      hdrs.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      hdrs.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      return new Response(resp.body, { status: resp.status, headers: hdrs });
    }

    return new Response('Not Found', { status: 404 });
  }
};
