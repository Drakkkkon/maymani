package kz.drakkkkon.moelenta;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Настройки уведомлений, расписание и сама проверка лент. */
final class Notify {
    private static final String CHANNEL = "news";
    private static final int JOB = 1;

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("notify", Context.MODE_PRIVATE);
    }

    static boolean allowed(Context c) {
        return c.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }

    /** Страница присылает: включено ли, слова, стоп-слова, ленты и уже виденные записи. */
    static synchronized void configure(Context c, String json) {
        try {
            JSONObject config = new JSONObject(json);
            JSONObject seen = config.optJSONObject("seen");
            config.remove("seen");
            SharedPreferences p = prefs(c);
            JSONObject all = new JSONObject(p.getString("seen", "{}"));
            if (seen != null) {
                // прочитанное в приложении не должно прийти уведомлением
                for (java.util.Iterator<String> it = seen.keys(); it.hasNext(); ) {
                    String url = it.next();
                    Set<String> ids = set(seen.optJSONArray(url));
                    for (String id : set(all.optJSONArray(url))) {
                        if (ids.size() >= 200) break;
                        ids.add(id);
                    }
                    all.put(url, new JSONArray(ids));
                }
            }
            p.edit().putString("config", config.toString()).putString("seen", all.toString()).apply();
            schedule(c, config.optBoolean("on"));
        } catch (Exception ignored) {
            // испорченные настройки не должны ронять приложение
        }
    }

    private static void schedule(Context c, boolean on) {
        JobScheduler jobs = c.getSystemService(JobScheduler.class);
        if (!on) {
            jobs.cancel(JOB);
            return;
        }
        // повторное планирование сбивало бы отсчёт времени
        if (jobs.getPendingJob(JOB) != null) return;
        jobs.schedule(new JobInfo.Builder(JOB, new ComponentName(c, CheckJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(30 * 60 * 1000L)
                .setPersisted(true)
                .build());
    }

    static String status(Context c) {
        SharedPreferences p = prefs(c);
        try {
            return new JSONObject().put("allowed", allowed(c)).put("last", p.getString("last", "")).toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    private static Set<String> set(JSONArray a) {
        Set<String> out = new LinkedHashSet<>();
        for (int i = 0; a != null && i < a.length(); i++) out.add(a.optString(i));
        return out;
    }

    private static byte[] download(String address) throws Exception {
        if (address.equals(Feeds.HUB)) address = "https://drakkkkon.github.io/maymani/js/data.js";
        if (address.startsWith("http://")) address = "https://" + address.substring(7);
        if (!address.startsWith("https://")) throw new Exception("не тот адрес");
        HttpURLConnection h = (HttpURLConnection) new URL(address).openConnection();
        h.setConnectTimeout(10000);
        h.setReadTimeout(15000);
        h.setRequestProperty("User-Agent", "Mozilla/5.0 (Android) MoeLenta/1.4.1");
        try {
            if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode());
            try (InputStream in = h.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                for (int n; (n = in.read(buf)) > 0; ) {
                    out.write(buf, 0, n);
                    if (out.size() > 6_000_000) throw new Exception("слишком большая лента");
                }
                return out.toByteArray();
            }
        } finally {
            h.disconnect();
        }
    }

    /** Проверяет все ленты. Вызывать не из главного потока. Возвращает итог словами. */
    static String check(Context c) {
        synchronized (CheckJob.class) { // две проверки сразу прислали бы одно и то же дважды
            return run(c);
        }
    }

    private static String run(Context c) {
        SharedPreferences p = prefs(c);
        int total = 0, failed = 0;
        List<String[]> fresh = new ArrayList<>();
        try {
            JSONObject config = new JSONObject(p.getString("config", "{}"));
            JSONArray feeds = config.optJSONArray("feeds");
            long deadline = System.currentTimeMillis() + 8 * 60 * 1000L;
            for (int n = 0; feeds != null && n < feeds.length() && System.currentTimeMillis() < deadline; n++) {
                JSONObject feed = feeds.getJSONObject(n);
                String url = feed.getString("url");
                total++;
                try {
                    List<Feeds.Item> list = Feeds.parse(download(url), url);
                    synchronized (Notify.class) {
                        JSONObject seen = new JSONObject(p.getString("seen", "{}"));
                        JSONObject checked = new JSONObject(p.getString("checked", "{}"));
                        Set<String> ids = set(seen.optJSONArray(url));
                        for (Feeds.Item i : Feeds.pick(ids, !checked.has(url), list, config.optString("words"), config.optString("stop")))
                            fresh.add(new String[]{feed.optString("title", "Мое_лента"), i.title, i.link});
                        seen.put(url, new JSONArray(ids));
                        checked.put(url, true);
                        p.edit().putString("seen", seen.toString()).putString("checked", checked.toString()).apply();
                    }
                } catch (Exception e) {
                    failed++; // эту ленту проверим в другой раз
                }
            }
            if (config.optBoolean("on")) {
                for (int i = 0; i < Math.min(fresh.size(), 5); i++) show(c, fresh.get(i)[0], fresh.get(i)[1], fresh.get(i)[2]);
                if (fresh.size() > 5) show(c, "Мое_лента", "И ещё новых записей: " + (fresh.size() - 5), "");
            }
        } catch (Exception e) {
            return "Проверка не удалась";
        }
        String text = new SimpleDateFormat("d MMMM, HH:mm", new Locale("ru")).format(new Date())
                + ": лент " + total + ", не загрузилось " + failed + ", новых записей " + fresh.size();
        p.edit().putString("last", text).apply();
        return text;
    }

    static void show(Context c, String title, String body, String url) {
        NotificationManager m = c.getSystemService(NotificationManager.class);
        m.createNotificationChannel(new NotificationChannel(CHANNEL, "Новые записи", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = url.startsWith("https://") || url.startsWith("http://")
                ? new Intent(Intent.ACTION_VIEW, Uri.parse(url))
                : new Intent(c, MainActivity.class);
        int id = (url.isEmpty() ? title + body : url).hashCode();
        m.notify(id, new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(0xFFE8641B)
                .setContentTitle(title.isEmpty() ? "Мое_лента" : title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .setAutoCancel(true)
                .build());
    }
}
