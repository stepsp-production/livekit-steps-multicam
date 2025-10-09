# LiveKit Multicam — Render API + Cloudflare Pages UI

## المتطلبات
- حساب **LiveKit Cloud** (API Key/Secret + WebSocket URL).
- حساب **Render** لنشر الـ API.
- حساب **Cloudflare Pages** لاستضافة الواجهة.
- (اختياري) عامل HLS على Cloudflare لديك (مثل: `hls-proxy.it-f2c.workers.dev`).

---

## 1) نشر الـ API على Render
1) أنشئ خدمة **Web Service** جديدة من هذا المجلد.
2) Render يقرأ `render.yaml` تلقائيًا أو اختر يدويًا:
   - Build Command: `npm install`
   - Start Command: `npm start`
3) أضف المتغيرات التالية في لوحة Render:
```
LIVEKIT_API_KEY=lkc_xxx
LIVEKIT_API_SECRET=xxx
LIVEKIT_WS_URL=wss://YOUR-SUBDOMAIN.livekit.cloud
LIVEKIT_HOST=https://YOUR-SUBDOMAIN.livekit.cloud
SETUP_ADMIN_KEY=choose-a-strong-secret
ORIGIN_BASE=https://stream.example.com
UPSTREAM_PREFIX=/hls
ALLOW_INSECURE_TLS=false
```
4) بعد التشغيل، سيكون عنوان خدمتك مثل: `https://steps-livekit-api.onrender.com`

### إنشاء الغرف
افتح:
```
GET https://steps-livekit-api.onrender.com/api/create-rooms?key=SETUP_ADMIN_KEY
```
سترى أسماء `studio-1..studio-10`.

---

## 2) رفع الواجهة على Cloudflare Pages
- ارفع ملف `index.html` كما هو (من هذا المشروع).
- لا تحتاج Build command.
- لتوجيه طلبات `/api/*` نحو Render استخدم Worker الموجود هنا (`worker.js`).

### Worker (proxy) الإعداد
- حدّث `wrangler.toml` بوضع:
```
API_BASE = "https://steps-livekit-api.onrender.com"
HLS_FORWARD = "https://hls-proxy.it-f2c.workers.dev"
```
- ثم:
```
npm i -g wrangler
wrangler publish
```
- اربط الـ Route على نطاق Pages لديك.

---

## 3) تشغيل
- افتح Cloudflare Pages.
- اختر غرفة (studio-1..studio-10).
- اضغط **تشغيل/بدء المزامنة** (يسمح بالوسائط، ثم يظهر شريط التقديم).
- اضغط **انضم للغرفة**.

## ملاحظات
- تم نقل **utilityControls** و **globalControls** داخل `#playerContainer` لتفعيل إخفاء/إظهار تلقائي مثل قائمة الكاميرات.
- تمت إضافة أحداث `mouseenter/leave` للمحافظة على ظهور الواجهة أثناء التحويم.
- CORS مفعّل على خادم Render.
- يمكنك الإبقاء على HLS عبر عامل Cloudflare الخاص بك (مضبوط في `window.HLS_BASE`).

