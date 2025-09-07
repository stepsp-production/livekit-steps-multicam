# LiveKit Multicam (Vercel + Serverless)

## المتطلبات
- حساب LiveKit Cloud (API Key/Secret + WebSocket URL)
- حساب Vercel

## الإعداد
1) انسخ `.env.example` إلى `.env` وأضف قيمك:
   - LIVEKIT_API_KEY
   - LIVEKIT_API_SECRET
   - LIVEKIT_WS_URL
   - SETUP_ADMIN_KEY (قيمة عشوائية)

2) ثبّت الحزم:
   npm i

3) جرّب محليًا (اختياري):
   vercel dev
   ثم افتح: http://localhost:3000

4) انشر على Vercel:
   vercel
   vercel env add  (أضف المتغيرات)
   vercel --prod

5) أنشئ الغرف (مرة واحدة):
   GET https://YOUR_APP.vercel.app/api/create-rooms?key=SETUP_ADMIN_KEY
   سترى { ok: true, results: [...] }

6) الاستخدام:
   افتح https://YOUR_APP.vercel.app
   - اختر غرفة من القائمة (studio-1 .. studio-10)
   - أدخل اسم العرض (اختياري)
   - اضغط "تشغيل/بدء المزامنة" لبدء المشغّل
   - اضغط "انضم للغرفة"
   سترى فيديوك وفيديو/صوت الآخرين في الشبكة.
