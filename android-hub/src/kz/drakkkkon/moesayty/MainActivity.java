package kz.drakkkkon.moesayty;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONObject;

/** Оболочка сайта Мое_Сайты: изменения сайта появляются в приложении сами. */
public class MainActivity extends Activity {
    static final String HOME = "https://drakkkkon.github.io/maymani/";
    private static final int ASK = 1;
    private WebView web;
    private volatile Updater.Release update;
    private volatile String updateText = "";
    private long lastUpdateCheck;
    private boolean checking, waitingPermission;
    private int offered;
    private AlertDialog offer;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        // не залезаем под строку состояния, кнопки навигации и клавиатуру
        root.setOnApplyWindowInsetsListener((View v, WindowInsets in) -> {
            v.setPadding(in.getSystemWindowInsetLeft(), in.getSystemWindowInsetTop(),
                    in.getSystemWindowInsetRight(), in.getSystemWindowInsetBottom());
            return in.consumeSystemWindowInsets();
        });
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.addJavascriptInterface(new Bridge(), "MSApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                String url = request.getUrl().toString();
                // внутри приложения только страницы самого сайта; архивы и другие сайты открывает браузер
                if (url.startsWith(HOME) && url.substring(HOME.length()).matches("([a-z]+\\.html)?([?#].*)?")) return false;
                // всё чужое открываем в браузере
                String scheme = request.getUrl().getScheme();
                if ("https".equals(scheme) || "http".equals(scheme) || "mailto".equals(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                    } catch (ActivityNotFoundException e) {
                        say("Нечем открыть ссылку");
                    }
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                view.loadDataWithBaseURL(null, "<meta charset=utf-8><meta name=viewport content='width=device-width'>"
                        + "<body style='font:18px sans-serif;text-align:center;padding:40px'>Нет связи с сайтом."
                        + "<p><a href='" + HOME + "'>Повторить</a></p>", "text/html", "utf-8", null);
            }
        });
        Notify.channel(this);
        Notify.schedule(this);
        askNotifications();
        // первая проверка запоминает, какие версии уже есть
        new Thread(() -> Notify.check(getApplicationContext())).start();

        String target = target(getIntent());
        if (target != null) web.loadUrl(target);
        else if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    private static String target(Intent i) {
        String url = i == null ? null : i.getDataString();
        return url != null && url.startsWith(HOME) ? url : null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String url = target(intent);
        if (url != null) web.loadUrl(url);
    }

    /** При первом запуске Android спрашивает разрешение на уведомления. */
    private void askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && Notify.on(this)
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED
                && !getPreferences(MODE_PRIVATE).getBoolean("asked", false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("asked", true).apply();
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, ASK);
        }
    }

    private void refresh() {
        web.evaluateJavascript("window.msRefresh&&msRefresh()", null);
    }

    private void say(String text) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

    private class Bridge {
        @JavascriptInterface
        public String notifyStatus() {
            Context c = getApplicationContext();
            try {
                return new JSONObject().put("on", Notify.on(c)).put("allowed", Notify.allowed(c))
                        .put("last", Notify.last(c)).toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void notifySet(boolean on) {
            Notify.setOn(getApplicationContext(), on);
            runOnUiThread(() -> {
                if (on) notifyAllow();
                refresh();
            });
        }

        @JavascriptInterface
        public void notifyAllow() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, ASK);
                }
            });
        }

        @JavascriptInterface
        public void notifyTest() {
            runOnUiThread(() -> {
                if (Notify.allowed(MainActivity.this)) Notify.show(MainActivity.this, "Мое_Сайты", "Уведомления работают ✅", "");
                else say("Уведомления выключены в настройках телефона");
            });
        }

        @JavascriptInterface
        public void notifyCheck() {
            new Thread(() -> {
                Notify.check(getApplicationContext());
                runOnUiThread(MainActivity.this::refresh);
            }).start();
        }

        @JavascriptInterface
        public void notifySettings() {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())));
        }

        @JavascriptInterface
        public String updateStatus() {
            try {
                Updater.Release r = update;
                return new JSONObject().put("installed", Updater.installedName(MainActivity.this))
                        .put("available", r == null ? "" : r.version).put("text", updateText).toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void updateCheck() {
            runOnUiThread(() -> checkUpdate(true));
        }

        @JavascriptInterface
        public void updateInstall() {
            runOnUiThread(MainActivity.this::installUpdate);
        }

    }

    @Override
    protected void onResume() {
        super.onResume();
        if (waitingPermission) {
            // вернулись из настроек, где разрешают установку
            waitingPermission = false;
            if (getPackageManager().canRequestPackageInstalls()) installUpdate();
        } else if (System.currentTimeMillis() - lastUpdateCheck > 3 * 3600_000L) {
            checkUpdate(false);
        }
        refresh();
    }

    private void checkUpdate(boolean asked) {
        if (checking) return;
        checking = true;
        lastUpdateCheck = System.currentTimeMillis();
        new Thread(() -> {
            Updater.Release found = null;
            String text;
            try {
                found = Updater.fetch(getApplicationContext());
                text = found == null ? "Установлена последняя версия." : "Версия " + found.version + " скачана.";
            } catch (Exception e) {
                text = "Не получилось проверить обновление. Проверьте интернет и попробуйте ещё раз.";
                lastUpdateCheck = 0;
            }
            final Updater.Release result = found;
            final String message = text;
            runOnUiThread(() -> {
                checking = false;
                if (isDestroyed()) return;
                update = result;
                updateText = message;
                refresh();
                if (result != null && !isFinishing() && (asked || offered != result.code)) offerUpdate(result);
            });
        }).start();
    }

    private void offerUpdate(Updater.Release r) {
        if (offer != null && offer.isShowing()) return;
        offered = r.code;
        offer = new AlertDialog.Builder(this)
                .setTitle("Доступна версия " + r.version)
                .setMessage(r.notes)
                .setPositiveButton("Обновить", (d, w) -> installUpdate())
                .setNegativeButton("Позже", null)
                .show();
    }

    private void installUpdate() {
        Updater.Release r = update;
        if (r == null) {
            checkUpdate(true);
            return;
        }
        if (!getPackageManager().canRequestPackageInstalls()) {
            say("Разрешите установку для «Мое_Сайты» и вернитесь назад");
            waitingPermission = true;
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            } catch (ActivityNotFoundException e) {
                waitingPermission = false;
                say("Откройте настройки телефона и разрешите установку из этого приложения");
            }
            return;
        }
        new Thread(() -> {
            try {
                Updater.install(getApplicationContext(), r.file);
            } catch (Exception e) {
                // файл мог пропасть из кэша: при следующей попытке скачаем заново
                runOnUiThread(() -> {
                    update = null;
                    say("Не получилось начать установку. Нажмите «Проверить обновление».");
                });
            }
        }).start();
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        if (request == ASK) refresh();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
