package kz.drakkkkon.moesayty;

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
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Системные уведомления: новые версии программ на сайте и новая версия самого приложения. */
final class Notify {
    private static final String CHANNEL = "versions";
    private static final String DATA = "https://drakkkkon.github.io/maymani/js/data.js";
    private static final int JOB = 1;

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("notify", Context.MODE_PRIVATE);
    }

    static boolean allowed(Context c) {
        return c.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }

    static boolean on(Context c) {
        return prefs(c).getBoolean("on", true);
    }

    static String last(Context c) {
        return prefs(c).getString("last", "");
    }

    static void setOn(Context c, boolean on) {
        prefs(c).edit().putBoolean("on", on).apply();
        schedule(c);
    }

    /** Канал создаётся сразу, чтобы приложение было видно в настройках уведомлений телефона. */
    static void channel(Context c) {
        c.getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(CHANNEL, "Новые версии", NotificationManager.IMPORTANCE_DEFAULT));
    }

    static void schedule(Context c) {
        JobScheduler jobs = c.getSystemService(JobScheduler.class);
        if (!on(c)) {
            jobs.cancel(JOB);
            return;
        }
        // повторное планирование сбивало бы отсчёт времени
        if (jobs.getPendingJob(JOB) != null) return;
        jobs.schedule(new JobInfo.Builder(JOB, new ComponentName(c, CheckJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(60 * 60 * 1000L)
                .setPersisted(true)
                .build());
    }

    /** Не из главного потока. */
    static synchronized void check(Context c) {
        SharedPreferences p = prefs(c);
        String stamp = new SimpleDateFormat("d MMMM, HH:mm", new Locale("ru")).format(new Date());
        try {
            String text = new String(Updater.download(DATA + "?t=" + System.currentTimeMillis(), 8_000_000), StandardCharsets.UTF_8);
            int start = text.indexOf('{', text.indexOf("window.HUB"));
            JSONArray programs = new JSONObject(text.substring(start, text.lastIndexOf('}') + 1)).getJSONArray("programs");
            JSONObject seen = new JSONObject(p.getString("seen", "{}"));
            boolean first = seen.length() == 0;
            List<String[]> fresh = new ArrayList<>();
            for (int i = 0; i < programs.length(); i++) {
                JSONObject program = programs.getJSONObject(i);
                String id = program.getString("id");
                // о новой версии самого приложения сообщает отдельное уведомление ниже
                if (id.equals("hub")) continue;
                JSONObject v = program.getJSONArray("versions").getJSONObject(0);
                String key = v.optString("v") + "|" + v.optString("date") + "|" + v.optString("file");
                if (!first && !key.equals(seen.optString(id)))
                    fresh.add(new String[]{program.getString("name"), "Новая версия " + v.optString("v"), program.optString("page")});
                seen.put(id, key);
            }
            p.edit().putString("seen", seen.toString()).apply();
            if (on(c)) {
                for (int i = 0; i < Math.min(fresh.size(), 5); i++) show(c, fresh.get(i)[0], fresh.get(i)[1], fresh.get(i)[2]);
                if (fresh.size() > 5) show(c, "Мое_Сайты", "И ещё обновлений: " + (fresh.size() - 5), "");
            }
            Updater.Release r = Updater.fetch(c);
            if (r != null && on(c) && p.getInt("told", 0) != r.code) {
                show(c, "Мое_Сайты", "Доступна версия приложения " + r.version, "");
                p.edit().putInt("told", r.code).apply();
            }
            p.edit().putString("last", stamp + ": новых версий программ " + fresh.size()).apply();
        } catch (Exception e) {
            p.edit().putString("last", stamp + ": проверить не получилось").apply();
        }
    }

    /** page — страница программы на сайте или пустая строка. */
    static void show(Context c, String title, String body, String page) {
        channel(c);
        Intent open = new Intent(c, MainActivity.class);
        if (page.matches("[a-z]+\\.html")) open.setData(Uri.parse(MainActivity.HOME + page));
        int id = (title + page).hashCode();
        c.getSystemService(NotificationManager.class).notify(id, new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(0xFF6750A4)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .setAutoCancel(true)
                .build());
    }
}
