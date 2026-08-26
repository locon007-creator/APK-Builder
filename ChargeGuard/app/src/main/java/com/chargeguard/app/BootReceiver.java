package com.chargeguard.app;
import android.content.*;

public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (context.getSharedPreferences("chargeguard", Context.MODE_PRIVATE).getBoolean("enabled", true)) {
            context.startForegroundService(new Intent(context, BatteryMonitorService.class));
        }
    }
}
