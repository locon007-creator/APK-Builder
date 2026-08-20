package com.chargeguard.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.provider.OpenableColumns;

public final class SoundSelection {
    private SoundSelection() {}

    public static Uri resolve(Context context, SharedPreferences prefs, boolean disconnect) {
        String key = disconnect ? "highSoundUri" : "lowSoundUri";
        String stored = prefs.getString(key, "");
        if (!stored.isEmpty()) {
            try {
                Uri uri = Uri.parse(stored);
                Ringtone candidate = RingtoneManager.getRingtone(context, uri);
                if (candidate != null) return uri;
            } catch (Exception ignored) {}
        }
        Uri fallback = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        return fallback != null ? fallback : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
    }

    public static String label(Context context, String stored) {
        if (stored == null || stored.isEmpty()) return "System alarm";
        try {
            Uri uri = Uri.parse(stored);
            if ("content".equals(uri.getScheme())) {
                try (Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        String name = cursor.getString(0);
                        if (name != null && !name.isEmpty()) return trimExtension(name);
                    }
                }
            }
            Ringtone ringtone = RingtoneManager.getRingtone(context, uri);
            if (ringtone != null) return ringtone.getTitle(context);
        } catch (Exception ignored) {}
        return "Sound unavailable";
    }

    private static String trimExtension(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }
}
