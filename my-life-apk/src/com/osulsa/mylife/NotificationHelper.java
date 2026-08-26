package com.osulsa.mylife;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;

public final class NotificationHelper {
  public static final String CHANNEL_ID = "my_life_reminders";

  private NotificationHelper() {}

  public static void ensureChannel(Context context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel = new NotificationChannel(
          CHANNEL_ID, "My Life reminders", NotificationManager.IMPORTANCE_DEFAULT);
      channel.setDescription("Reminders you choose inside My Life");
      channel.enableVibration(true);
      NotificationManager manager = context.getSystemService(NotificationManager.class);
      if (manager != null) manager.createNotificationChannel(channel);
    }
  }

  public static void show(Context context, String key, String title, String message) {
    if (Build.VERSION.SDK_INT >= 33 &&
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      return;
    }
    ensureChannel(context);
    Intent launch = new Intent(context, MainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent content = PendingIntent.getActivity(context, 10, launch,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Notification notification = new Notification.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(title)
        .setContentText(message)
        .setStyle(new Notification.BigTextStyle().bigText(message))
        .setCategory(Notification.CATEGORY_REMINDER)
        .setAutoCancel(true)
        .setContentIntent(content)
        .build();
    NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (manager != null) manager.notify(Math.abs(key.hashCode()), notification);
  }
}
