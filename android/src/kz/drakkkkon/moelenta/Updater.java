package kz.drakkkkon.moelenta;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONObject;

/**
 * Обновление приложения. Описание новой версии берётся только с нашего сайта, файл — только из нашего
 * репозитория; чужую подпись Android не установит поверх приложения.
 */
final class Updater {
    private static final String INFO = "https://drakkkkon.github.io/maymani/rss/update.json";
    private static final String FILES = "https://raw.githubusercontent.com/Drakkkkon/maymani/archives/rss/";

    static final class Release {
        final int code;
        final String version, notes;
        final File file;
        Release(int code, String version, String notes, File file) {
            this.code = code;
            this.version = version;
            this.notes = notes;
            this.file = file;
        }
    }

    @SuppressWarnings("deprecation")
    static int installedCode(Context c) throws Exception {
        return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionCode;
    }

    static String installedName(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /** Скачанный и проверенный новый APK или null, если стоит свежая версия. Не из главного потока. */
    static synchronized Release fetch(Context c) throws Exception {
        JSONObject info = new JSONObject(new String(
                download(INFO + "?t=" + System.currentTimeMillis(), 100_000), StandardCharsets.UTF_8));
        File dir = new File(c.getCacheDir(), "update");
        int code = info.getInt("versionCode");
        if (code <= installedCode(c)) {
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            return null;
        }
        String address = info.getString("url");
        if (!address.startsWith(FILES) || address.contains("..")) throw new Exception("не тот адрес");
        String sha = info.getString("sha256");
        File file = new File(dir, code + ".apk");
        if (!file.exists() || !sha.equalsIgnoreCase(sha256(file))) {
            dir.mkdirs();
            byte[] data = download(address, 50_000_000);
            try (OutputStream out = new FileOutputStream(file)) {
                out.write(data);
            }
            if (!sha.equalsIgnoreCase(sha256(file))) {
                file.delete();
                throw new Exception("файл скачался с ошибкой");
            }
        }
        return new Release(code, info.getString("version"), info.optString("notes"), file);
    }

    private static byte[] download(String address, int max) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(address).openConnection();
        h.setConnectTimeout(15000);
        h.setReadTimeout(30000);
        h.setUseCaches(false);
        try {
            if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode());
            try (InputStream in = h.getInputStream()) {
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                for (int n; (n = in.read(buf)) > 0; ) {
                    out.write(buf, 0, n);
                    if (out.size() > max) throw new Exception("слишком большой файл");
                }
                return out.toByteArray();
            }
        } finally {
            h.disconnect();
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[16384];
            for (int n; (n = in.read(buf)) > 0; ) md.update(buf, 0, n);
        }
        StringBuilder s = new StringBuilder();
        for (byte b : md.digest()) s.append(String.format("%02x", b & 0xff));
        return s.toString();
    }

    /** Передаёт файл установщику Android; тот спросит подтверждение. */
    static void install(Context c, File file) throws Exception {
        PackageInstaller installer = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(c.getPackageName());
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(file); OutputStream out = session.openWrite("app.apk", 0, file.length())) {
                byte[] buf = new byte[16384];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                session.fsync(out);
            }
            // установщик дописывает в этот вызов результат, поэтому он должен быть изменяемым
            int flags = PendingIntent.FLAG_UPDATE_CURRENT
                    | (android.os.Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            session.commit(PendingIntent.getBroadcast(c, id, new Intent(c, InstallReceiver.class), flags).getIntentSender());
        } catch (Exception e) {
            installer.abandonSession(id);
            throw e;
        }
    }
}
