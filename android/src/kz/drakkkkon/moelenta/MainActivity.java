package kz.drakkkkon.moelenta;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.json.JSONObject;

/** Оболочка сайта Мое_лента: новые версии сайта появляются в приложении сами. */
public class MainActivity extends Activity {
    private static final String HOME = "https://drakkkkon.github.io/maymani/rss/";
    private static final int PICK = 1, SAVE = 2, ASK = 3;
    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady;
    private ValueCallback<Uri[]> picker;
    private String saveText;
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
        web.addJavascriptInterface(new Bridge(), "MLApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                String url = request.getUrl().toString();
                if (url.startsWith(HOME)) return false;
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
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (picker != null) picker.onReceiveValue(null);
                picker = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try {
                    startActivityForResult(i, PICK);
                } catch (ActivityNotFoundException e) {
                    picker = null;
                    return false;
                }
                return true;
            }
        });

        tts = new TextToSpeech(this, status -> ttsReady = status == TextToSpeech.SUCCESS);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { event(id, "start"); }
            @Override public void onDone(String id) { event(id, "end"); }
            @Override public void onError(String id) { event(id, "error"); }
        });

        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    private void event(String id, String name) {
        if (!id.matches("\\d+")) return;
        runOnUiThread(() -> web.evaluateJavascript("window.mlTts&&mlTts('" + id + "','" + name + "')", null));
    }

    private void say(String text) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

    private class Bridge {
        @JavascriptInterface
        public void speak(String text, String lang, float rate, String id) {
            if (!ttsReady) {
                event(id, "error");
                return;
            }
            tts.setLanguage(Locale.forLanguageTag(lang));
            tts.setSpeechRate(rate);
            if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) event(id, "error");
        }

        @JavascriptInterface
        public void stopSpeak() {
            tts.stop();
        }

        @JavascriptInterface
        public void notifyConfig(String json) {
            Notify.configure(getApplicationContext(), json);
        }

        @JavascriptInterface
        public String notifyStatus() {
            return Notify.status(getApplicationContext());
        }

        @JavascriptInterface
        public void notifyAllow() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, ASK);
                } else {
                    allowResult();
                }
            });
        }

        @JavascriptInterface
        public void notifyCheck() {
            new Thread(() -> {
                Notify.check(getApplicationContext());
                runOnUiThread(() -> web.evaluateJavascript("window.mlChecked&&mlChecked()", null));
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

        @JavascriptInterface
        public void share(String title, String url) {
            Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, (title + "\n" + url).trim());
            runOnUiThread(() -> startActivity(Intent.createChooser(i, "Поделиться")));
        }

        @JavascriptInterface
        public void save(String name, String text, String type) {
            runOnUiThread(() -> {
                saveText = text;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(type).putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(i, SAVE);
                } catch (ActivityNotFoundException e) {
                    say("Нечем сохранить файл");
                }
            });
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
                web.evaluateJavascript("window.mlUpdate&&mlUpdate()", null);
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
            say("Разрешите установку для «Мое_лента» и вернитесь назад");
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

    private void allowResult() {
        boolean ok = Notify.allowed(this);
        if (ok) Notify.show(this, "Мое_лента", "Уведомления включены ✅", "");
        web.evaluateJavascript("window.mlAllowed&&mlAllowed(" + ok + ")", null);
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        if (request == ASK) allowResult();
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        if (request == PICK && picker != null) {
            picker.onReceiveValue(uri == null ? null : new Uri[]{uri});
            picker = null;
        }
        if (request == SAVE && uri != null && saveText != null) {
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                out.write(saveText.getBytes(StandardCharsets.UTF_8));
                say("Файл сохранён");
            } catch (Exception e) {
                say("Не получилось сохранить файл");
            }
        }
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
        tts.shutdown();
        web.destroy();
        super.onDestroy();
    }
}
