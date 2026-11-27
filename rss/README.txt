Мое_лента 1.4.2 — RSS-читалка для телефона и ПК.
Адрес: https://drakkkkon.github.io/maymani/rss/
Архивы версий: ветка archives, папка rss/.
При новой версии поменяйте VERSION в app.js и CACHE в sw.js.
Push-уведомления: .github/workflows/lenta-push.yml и .github/lenta-push/send.js, настройки в секрете LENTA_PUSH.
Приложение Android: папка android/ (оболочка WebView, открывает этот сайт), сборка android/build.sh. Ключ подписи в репозиторий не класть.
readability.js — @mozilla/readability 0.6.0 (Apache-2.0).
Новая версия APK: поднять versionCode/versionName, подписать тем же ключом, положить .apk в archives/rss/, затем обновить rss/update.json (versionCode, version, url, sha256, notes).
