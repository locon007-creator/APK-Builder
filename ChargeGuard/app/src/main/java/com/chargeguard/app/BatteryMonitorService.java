package com.chargeguard.app;

import android.app.*;
import android.content.*;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.*;

public class BatteryMonitorService extends Service {
    public static final String STATUS_CHANNEL = "monitor_status";
    public static final String ALERT_CHANNEL = "battery_alerts_v2";
    private static final int STATUS_ID = 41;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Ringtone ringtone;
    private boolean lowLatched, highLatched;
    public static final String ACTION_STOP_ALARM = "STOP_ALARM";
    public static final String ACTION_SNOOZE = "SNOOZE";
    public static final String ACTION_DISABLE = "DISABLE";

    private final BroadcastReceiver batteryReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!Intent.ACTION_BATTERY_CHANGED.equals(intent.getAction())) return;
            int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int percent = Math.round(level * 100f / Math.max(1, scale));
            int status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
            getSharedPreferences("chargeguard", MODE_PRIVATE).edit().putInt("lastLevel", percent).putBoolean("lastCharging", charging).apply();
            sendBroadcast(new Intent("com.chargeguard.STATUS").setPackage(getPackageName()).putExtra("level", percent).putExtra("charging", charging));
            updateStatus(percent, charging);
            evaluate(percent, charging);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        createChannels();
        startForeground(STATUS_ID, statusNotification(-1, false));
        registerReceiver(batteryReceiver, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP_ALARM.equals(intent.getAction())) {
            stopAlert();
            return START_STICKY;
        }
        if (intent != null && ACTION_SNOOZE.equals(intent.getAction())) {
            getSharedPreferences("chargeguard", MODE_PRIVATE).edit()
                    .putLong("snoozeUntil", System.currentTimeMillis() + 30L * 60L * 1000L).apply();
            stopAlert();
            getSystemService(NotificationManager.class).cancel(21);
            getSystemService(NotificationManager.class).cancel(86);
            return START_STICKY;
        }
        if (intent != null && ACTION_DISABLE.equals(intent.getAction())) {
            getSharedPreferences("chargeguard", MODE_PRIVATE).edit().putBoolean("enabled", false).apply();
            stopAlert();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && "TEST_LOW".equals(intent.getAction())) alert(false, 20);
        if (intent != null && "TEST_HIGH".equals(intent.getAction())) alert(true, 85);
        return START_STICKY;
    }

    private void evaluate(int percent, boolean charging) {
        android.content.SharedPreferences p = getSharedPreferences("chargeguard", MODE_PRIVATE);
        if (!p.getBoolean("enabled", true)) { stopSelf(); return; }
        if (System.currentTimeMillis() < p.getLong("snoozeUntil", 0L)) return;
        int low = p.getInt("low", 20), high = p.getInt("high", 85);
        if (!charging && percent <= low && !lowLatched) { lowLatched = true; alert(false, percent); }
        if (percent > low + 3 || charging) lowLatched = false;
        if (charging && percent >= high && !highLatched) { highLatched = true; alert(true, percent); }
        if (percent < high - 3 || !charging) highLatched = false;
    }

    private void alert(boolean disconnect, int percent) {
        android.content.SharedPreferences prefs = getSharedPreferences("chargeguard", MODE_PRIVATE);
        String title = disconnect ? "Disconnect your charger" : "Charge your phone now";
        String text = disconnect ? "Battery is at " + percent + "% — unplug to protect long-term battery health." : "Battery is down to " + percent + "% — connect your charger.";
        prefs.edit().putString("lastAlert", title + " at " + percent + "%").putLong("lastAlertTime", System.currentTimeMillis()).apply();
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, disconnect ? 2 : 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stopPi = PendingIntent.getService(this, 90, new Intent(this, BatteryMonitorService.class).setAction(ACTION_STOP_ALARM), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent snoozePi = PendingIntent.getService(this, 91, new Intent(this, BatteryMonitorService.class).setAction(ACTION_SNOOZE), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, ALERT_CHANNEL)
                .setSmallIcon(R.drawable.ic_app).setContentTitle(title).setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(pi).setAutoCancel(true)
                .addAction(new Notification.Action.Builder(null, "Stop alarm", stopPi).build())
                .addAction(new Notification.Action.Builder(null, "Snooze 30 min", snoozePi).build())
                .setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PUBLIC).build();
        getSystemService(NotificationManager.class).notify(disconnect ? 86 : 21, n);
        try {
            Uri uri = SoundSelection.resolve(this, prefs, disconnect);
            if (prefs.getBoolean("soundEnabled", true)) {
                ringtone = RingtoneManager.getRingtone(this, uri);
                if (ringtone != null) ringtone.play();
            }
            if (prefs.getBoolean("vibrationEnabled", true)) {
                if (Build.VERSION.SDK_INT >= 31) {
                    ((VibratorManager)getSystemService(VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator().vibrate(VibrationEffect.createWaveform(new long[]{0,500,250,500,250,800}, -1));
                } else {
                    ((Vibrator)getSystemService(VIBRATOR_SERVICE)).vibrate(VibrationEffect.createWaveform(new long[]{0,500,250,500,250,800}, -1));
                }
            }
            int duration = prefs.getInt("alarmDuration", 15);
            if (duration > 0) handler.postDelayed(this::stopAlert, duration * 1000L);
        } catch (Exception ignored) { }
    }

    private void stopAlert() {
        if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
        try {
            if (Build.VERSION.SDK_INT >= 31) ((VibratorManager)getSystemService(VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator().cancel();
            else ((Vibrator)getSystemService(VIBRATOR_SERVICE)).cancel();
        } catch (Exception ignored) { }
    }

    private void createChannels() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel status = new NotificationChannel(STATUS_CHANNEL, "Battery monitoring", NotificationManager.IMPORTANCE_LOW);
        status.setDescription("Keeps ChargeGuard active in the background");
        NotificationChannel alerts = new NotificationChannel(ALERT_CHANNEL, "Charge alerts", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("Charge and disconnect alerts; sound and vibration are controlled inside ChargeGuard");
        alerts.enableVibration(false);
        alerts.setSound(null, null);
        nm.createNotificationChannel(status);
        nm.createNotificationChannel(alerts);
    }

    private Notification statusNotification(int percent, boolean charging) {
        String text = percent < 0 ? "Starting battery protection…" : percent + "% • " + (charging ? "Charging" : "On battery");
        PendingIntent pi = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, STATUS_CHANNEL).setSmallIcon(R.drawable.ic_app).setContentTitle("ChargeGuard is protecting your phone").setContentText(text).setContentIntent(pi).setOngoing(true).build();
    }
    private void updateStatus(int percent, boolean charging) { getSystemService(NotificationManager.class).notify(STATUS_ID, statusNotification(percent, charging)); }
    @Override public void onDestroy() { try { unregisterReceiver(batteryReceiver); } catch (Exception ignored) {} stopAlert(); super.onDestroy(); }
    @Override public android.os.IBinder onBind(Intent intent) { return null; }
}
