package com.chargeguard.app;

import android.app.*;
import android.content.*;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.*;

public class BatteryMonitorService extends Service {
    public static final String STATUS_CHANNEL = "monitor_status";
    public static final String ALERT_CHANNEL = "battery_alerts";
    private static final int STATUS_ID = 41;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Ringtone ringtone;
    private boolean lowLatched, highLatched;

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
        if (intent != null && "TEST_LOW".equals(intent.getAction())) alert(false, 20);
        if (intent != null && "TEST_HIGH".equals(intent.getAction())) alert(true, 85);
        return START_STICKY;
    }

    private void evaluate(int percent, boolean charging) {
        android.content.SharedPreferences p = getSharedPreferences("chargeguard", MODE_PRIVATE);
        if (!p.getBoolean("enabled", true)) { stopSelf(); return; }
        int low = p.getInt("low", 20), high = p.getInt("high", 85);
        if (!charging && percent <= low && !lowLatched) { lowLatched = true; alert(false, percent); }
        if (percent > low + 3 || charging) lowLatched = false;
        if (charging && percent >= high && !highLatched) { highLatched = true; alert(true, percent); }
        if (percent < high - 3 || !charging) highLatched = false;
    }

    private void alert(boolean disconnect, int percent) {
        String title = disconnect ? "Disconnect your charger" : "Charge your phone now";
        String text = disconnect ? "Battery is at " + percent + "% — unplug to protect long-term battery health." : "Battery is down to " + percent + "% — connect your charger.";
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, disconnect ? 2 : 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, ALERT_CHANNEL)
                .setSmallIcon(R.drawable.ic_app).setContentTitle(title).setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(pi).setAutoCancel(true)
                .setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PUBLIC).build();
        getSystemService(NotificationManager.class).notify(disconnect ? 86 : 21, n);
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            ringtone = RingtoneManager.getRingtone(this, uri);
            if (ringtone != null) ringtone.play();
            if (Build.VERSION.SDK_INT >= 31) {
                ((VibratorManager)getSystemService(VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator().vibrate(VibrationEffect.createWaveform(new long[]{0,500,250,500,250,800}, -1));
            } else {
                ((Vibrator)getSystemService(VIBRATOR_SERVICE)).vibrate(VibrationEffect.createWaveform(new long[]{0,500,250,500,250,800}, -1));
            }
            handler.postDelayed(() -> { if (ringtone != null && ringtone.isPlaying()) ringtone.stop(); }, 15000);
        } catch (Exception ignored) { }
    }

    private void createChannels() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel status = new NotificationChannel(STATUS_CHANNEL, "Battery monitoring", NotificationManager.IMPORTANCE_LOW);
        status.setDescription("Keeps ChargeGuard active in the background");
        Uri alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        NotificationChannel alerts = new NotificationChannel(ALERT_CHANNEL, "Charge alerts", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("Loud charge and disconnect alerts");
        alerts.enableVibration(true);
        alerts.setVibrationPattern(new long[]{0,500,250,500,250,800});
        if (alarm != null) alerts.setSound(alarm, new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_ALARM).build());
        nm.createNotificationChannel(status);
        nm.createNotificationChannel(alerts);
    }

    private Notification statusNotification(int percent, boolean charging) {
        String text = percent < 0 ? "Starting battery protection…" : percent + "% • " + (charging ? "Charging" : "On battery");
        PendingIntent pi = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, STATUS_CHANNEL).setSmallIcon(R.drawable.ic_app).setContentTitle("ChargeGuard is protecting your phone").setContentText(text).setContentIntent(pi).setOngoing(true).build();
    }
    private void updateStatus(int percent, boolean charging) { getSystemService(NotificationManager.class).notify(STATUS_ID, statusNotification(percent, charging)); }
    @Override public void onDestroy() { try { unregisterReceiver(batteryReceiver); } catch (Exception ignored) {} if (ringtone != null) ringtone.stop(); super.onDestroy(); }
    @Override public android.os.IBinder onBind(Intent intent) { return null; }
}
