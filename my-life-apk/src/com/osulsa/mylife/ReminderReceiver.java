package com.osulsa.mylife;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import org.json.JSONObject;

public final class ReminderReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context, Intent intent) {
    String key = intent.getStringExtra("key");
    if (key == null) return;
    SharedPreferences prefs = context.getSharedPreferences("my_life_reminders", Context.MODE_PRIVATE);
    String raw = prefs.getString("spec:" + key, null);
    if (raw == null) return;
    try {
      JSONObject spec = new JSONObject(raw);
      NotificationHelper.show(context, key,
          spec.optString("title", "My Life"), spec.optString("message", "My Life reminder"));
    } catch (Exception ignored) {}
    ReminderScheduler.reminderFired(context, key);
  }
}
