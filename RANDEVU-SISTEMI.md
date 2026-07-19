# Sakura randevu sistemini canlı kullanıma açma

Site yerelde otomatik olarak demo modunda çalışır. Demo yönetici kodu `2468` olur ve veriler yalnızca aynı tarayıcıda görünür.

Farklı telefon ve bilgisayarlardan gelen gerçek randevuların ortak görünmesi için Vercel projesine ücretsiz bir Upstash Redis veritabanı bağlayın ve şu üç Environment Variable değerini ekleyin:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `ADMIN_SECRET` (yalnızca sizin bileceğiniz güçlü bir yönetici kodu)

Değişkenleri ekledikten sonra Vercel'de yeniden yayınlama yapılmalıdır. Müşteri giriş yapmadan randevu talebi gönderir. Talep önce beklemede görünür; yönetici sayfanın altındaki **Yönetim** bağlantısından onay verdiğinde seçilen tarih ve saat dolu olur.

## Yönetim panelini açma

Canlı sitede yönetim paneline iki şekilde ulaşabilirsiniz:

- Ana sayfanın en altındaki **Yönetim** bağlantısı
- Doğrudan `https://alan-adiniz/admin.html` adresi

Girişte Vercel'e `ADMIN_SECRET` adıyla kaydettiğiniz yönetici kodunu kullanın.
