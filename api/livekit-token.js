// CommonJS ليتوافق تلقائياً مع Vercel Functions
const { AccessToken } = require('livekit-server-sdk');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey  = process.env.LIVEKIT_API_KEY;
    const apiSec  = process.env.LIVEKIT_API_SECRET;
    const wsUrl   = process.env.LIVEKIT_WS_URL;

    if (!apiKey || !apiSec || !wsUrl) {
      return res.status(500).json({ error: 'Server not configured' });
    }

    // احصل على المعطيات من body (POST) أو query (GET)
    const src = req.method === 'POST' ? req.body : req.query;
    const room      = (src.room || '').toString().trim();
    const identity  = (src.identity || '').toString().trim();
    const name      = (src.name || '').toString().trim();
    const canPub    = src.canPublish !== 'false' && src.canPublish !== false;
    const canSub    = src.canSubscribe !== 'false' && src.canSubscribe !== false;

    if (!room) return res.status(400).json({ error: 'room is required' });

    // توليد هوية افتراضية إن لم تُرسل
    const userId = identity || `u_${Math.random().toString(36).slice(2, 10)}`;

    // أنشئ التوكن وضع الهوية والاسم وصلاحية مؤقتة
    const at = new AccessToken(apiKey, apiSec, {
      identity: userId,
      name: name || userId,
      ttl: 60 * 60, // 1 ساعة
    });

    // منح الصلاحيات
    at.addGrant({
      roomJoin: true,
      room,
      canPublish: canPub,
      canSubscribe: canSub,
      canPublishData: true,
    });

    const token = await at.toJwt();
    res.status(200).json({ token, wsUrl, identity: userId, room });
  } catch (e) {
    console.error('livekit-token error', e);
    res.status(500).json({ error: 'internal_error' });
  }
};
