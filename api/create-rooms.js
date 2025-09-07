const { RoomServiceClient } = require('livekit-server-sdk');

const DEFAULT_ROOMS = [
  'studio-1','studio-2','studio-3','studio-4','studio-5',
  'studio-6','studio-7','studio-8','studio-9','studio-10'
];

module.exports = async (req, res) => {
  try {
    const { LIVEKIT_WS_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, SETUP_ADMIN_KEY } = process.env;
    if (!LIVEKIT_WS_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return res.status(500).json({ error: 'Server not configured' });
    }

    // حماية بسيطة: ?key=SETUP_ADMIN_KEY
    const key = (req.query.key || '').toString();
    if (!SETUP_ADMIN_KEY || key !== SETUP_ADMIN_KEY) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const svc = new RoomServiceClient(LIVEKIT_WS_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    const results = [];
    for (const name of DEFAULT_ROOMS) {
      try {
        // createRoom يفشل لو موجودة؛ لذلك نحاول list → create إن لم توجد
        const list = await svc.listRooms([name]);
        if (!list.rooms || !list.rooms.find(r => r.name === name)) {
          const r = await svc.createRoom({
            name,
            maxParticipants: 20,
            emptyTimeout: 60 * 30, // تُغلق بعد 30 دقيقة من الخلو
          });
          results.push({ name, created: true, room: r });
        } else {
          results.push({ name, created: false, note: 'exists' });
        }
      } catch (e) {
        results.push({ name, error: e?.message || String(e) });
      }
    }

    res.status(200).json({ ok: true, results });
  } catch (e) {
    console.error('create-rooms error', e);
    res.status(500).json({ error: 'internal_error' });
  }
};
