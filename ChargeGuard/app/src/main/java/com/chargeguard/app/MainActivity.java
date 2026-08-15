package com.chargeguard.app;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;

public class MainActivity extends Activity {
    private LinearLayout root;
    private TextView percentView, statusView, monitorPill, lowValue, highValue, lastAlertView;
    private SeekBar lowBar, highBar;
    private Button monitorButton;
    private android.content.SharedPreferences prefs;
    private final int green = Color.rgb(33,208,122), ink = Color.rgb(7,17,13), cardColor = Color.rgb(18,34,27), muted = Color.rgb(159,180,170);

    private final BroadcastReceiver statusReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { updateBattery(i.getIntExtra("level", -1), i.getBooleanExtra("charging", false)); }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("chargeguard", MODE_PRIVATE);
        buildUi();
        requestNotifications();
        startMonitor();
        readCurrentBattery();
    }

    @Override protected void onStart() {
        super.onStart();
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(statusReceiver, new IntentFilter("com.chargeguard.STATUS"), RECEIVER_NOT_EXPORTED);
        else registerReceiver(statusReceiver, new IntentFilter("com.chargeguard.STATUS"));
    }
    @Override protected void onStop() { try { unregisterReceiver(statusReceiver); } catch (Exception ignored) {} super.onStop(); }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(ink);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(22), dp(24), dp(22), dp(32));
        scroll.addView(root);

        LinearLayout top = row();
        TextView brand = text("CHARGEGUARD", 15, Color.WHITE, Typeface.BOLD);
        brand.setLetterSpacing(.18f);
        top.addView(brand, new LinearLayout.LayoutParams(0, dp(44), 1));
        monitorPill = text("● ACTIVE", 12, green, Typeface.BOLD);
        monitorPill.setGravity(Gravity.CENTER);
        monitorPill.setBackground(round(Color.rgb(14,54,37), 100));
        top.addView(monitorPill, new LinearLayout.LayoutParams(dp(92), dp(38)));
        root.addView(top);
        spacer(28);

        TextView eyebrow = text("YOUR BATTERY", 12, muted, Typeface.BOLD);
        eyebrow.setLetterSpacing(.15f);
        root.addView(eyebrow);
        percentView = text("--%", 68, Color.WHITE, Typeface.BOLD);
        percentView.setPadding(0, dp(4), 0, 0);
        root.addView(percentView);
        statusView = text("Reading your Samsung phone…", 17, muted, Typeface.NORMAL);
        root.addView(statusView);
        spacer(24);

        LinearLayout safe = card();
        safe.addView(text("SMART CHARGE WINDOW", 13, muted, Typeface.BOLD));
        TextView headline = text("Charge at 20%  •  Unplug at 85%", 19, Color.WHITE, Typeface.BOLD);
        headline.setPadding(0,dp(8),0,dp(4));
        safe.addView(headline);
        safe.addView(text("ChargeGuard stays active with a small permanent notification so Android does not put it to sleep.", 14, muted, Typeface.NORMAL));
        root.addView(safe);
        spacer(16);

        LinearLayout settings = card();
        settings.addView(text("ALERT LEVELS", 13, muted, Typeface.BOLD));
        spacerIn(settings, 14);
        lowValue = text("Charge me at " + prefs.getInt("low",20) + "%", 17, Color.WHITE, Typeface.BOLD);
        settings.addView(lowValue);
        lowBar = new SeekBar(this);
        lowBar.setMax(25);
        lowBar.setProgress(prefs.getInt("low",20)-10);
        lowBar.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.rgb(255,177,61)));
        settings.addView(lowBar);
        highValue = text("Disconnect at " + prefs.getInt("high",85) + "%", 17, Color.WHITE, Typeface.BOLD);
        highValue.setPadding(0,dp(14),0,0);
        settings.addView(highValue);
        highBar = new SeekBar(this);
        highBar.setMax(20);
        highBar.setProgress(prefs.getInt("high",85)-75);
        highBar.setProgressTintList(android.content.res.ColorStateList.valueOf(green));
        settings.addView(highBar);
        root.addView(settings);
        spacer(16);
        lowBar.setOnSeekBarChangeListener(listener(true));
        highBar.setOnSeekBarChangeListener(listener(false));

        LinearLayout alertOptions = card();
        alertOptions.addView(text("ALERT SOUND", 13, muted, Typeface.BOLD));
        spacerIn(alertOptions, 10);
        Spinner sounds = new Spinner(this);
        String[] soundNames = {"Alarm sound", "Notification sound", "Phone ringtone"};
        ArrayAdapter<String> soundAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, soundNames) {
            @Override public View getView(int position, View convertView, android.view.ViewGroup parent) {
                TextView v = (TextView)super.getView(position, convertView, parent); v.setTextColor(Color.WHITE); v.setTextSize(16); v.setPadding(dp(8),dp(10),dp(8),dp(10)); return v;
            }
        };
        sounds.setAdapter(soundAdapter);
        sounds.setSelection(prefs.getInt("soundType", 0));
        sounds.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            public void onItemSelected(android.widget.AdapterView<?> p, View v, int position, long id) { prefs.edit().putInt("soundType", position).apply(); }
            public void onNothingSelected(android.widget.AdapterView<?> p) {}
        });
        alertOptions.addView(sounds, new LinearLayout.LayoutParams(-1,dp(52)));
        Switch soundToggle = new Switch(this);
        soundToggle.setText("Play sound");
        soundToggle.setTextColor(Color.WHITE);
        soundToggle.setTextSize(16);
        soundToggle.setChecked(prefs.getBoolean("soundEnabled", true));
        soundToggle.setPadding(4,dp(10),4,dp(10));
        soundToggle.setOnCheckedChangeListener((b, checked) -> prefs.edit().putBoolean("soundEnabled", checked).apply());
        alertOptions.addView(soundToggle);
        Switch vibrationToggle = new Switch(this);
        vibrationToggle.setText("Vibrate");
        vibrationToggle.setTextColor(Color.WHITE);
        vibrationToggle.setTextSize(16);
        vibrationToggle.setChecked(prefs.getBoolean("vibrationEnabled", true));
        vibrationToggle.setPadding(4,dp(8),4,dp(8));
        vibrationToggle.setOnCheckedChangeListener((b, checked) -> prefs.edit().putBoolean("vibrationEnabled", checked).apply());
        alertOptions.addView(vibrationToggle);
        root.addView(alertOptions);
        spacer(16);

        LinearLayout actions = row();
        Button lowTest = button("Test low alert", Color.rgb(46,55,50), Color.WHITE);
        lowTest.setOnClickListener(v -> test("TEST_LOW"));
        actions.addView(lowTest, new LinearLayout.LayoutParams(0,dp(54),1));
        Space gap = new Space(this);
        actions.addView(gap,new LinearLayout.LayoutParams(dp(10),1));
        Button highTest = button("Test unplug alert", green, ink);
        highTest.setOnClickListener(v -> test("TEST_HIGH"));
        actions.addView(highTest,new LinearLayout.LayoutParams(0,dp(54),1));
        root.addView(actions);
        spacer(12);

        Button stopAlarm = button("Stop current alarm", Color.rgb(116,36,36), Color.WHITE);
        stopAlarm.setOnClickListener(v -> {
            if (prefs.getBoolean("enabled", true)) {
                startService(new Intent(this, BatteryMonitorService.class).setAction(BatteryMonitorService.ACTION_STOP_ALARM));
                Toast.makeText(this,"Alarm stopped",Toast.LENGTH_SHORT).show();
            } else Toast.makeText(this,"Monitoring is already off",Toast.LENGTH_SHORT).show();
        });
        root.addView(stopAlarm,new LinearLayout.LayoutParams(-1,dp(56)));
        spacer(12);

        monitorButton = button("Deactivate monitoring", Color.rgb(46,55,50), Color.WHITE);
        monitorButton.setOnClickListener(v -> toggleMonitoring());
        root.addView(monitorButton,new LinearLayout.LayoutParams(-1,dp(56)));
        syncMonitoringUi();
        spacer(16);

        Button batterySettings = button("Allow unrestricted battery use", Color.TRANSPARENT, Color.WHITE);
        batterySettings.setBackground(roundStroke(cardColor, Color.rgb(67,87,77), 18));
        batterySettings.setOnClickListener(v -> openBatterySettings());
        root.addView(batterySettings,new LinearLayout.LayoutParams(-1,dp(56)));
        TextView note = text("For the most reliable alerts on Samsung, tap the button above and choose Unrestricted. Monitoring automatically resumes after restart.", 13, muted, Typeface.NORMAL);
        note.setPadding(4,dp(12),4,0);
        root.addView(note);
        lastAlertView = text(lastAlertText(), 13, muted, Typeface.NORMAL);
        lastAlertView.setPadding(4,dp(14),4,0);
        root.addView(lastAlertView);
        setContentView(scroll);
    }

    private SeekBar.OnSeekBarChangeListener listener(boolean low) {
        return new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar b,int p,boolean user) {
                int value=(low?10:75)+p;
                prefs.edit().putInt(low?"low":"high",value).apply();
                (low?lowValue:highValue).setText((low?"Charge me at ":"Disconnect at ")+value+"%");
            }
            public void onStartTrackingTouch(SeekBar b){}
            public void onStopTrackingTouch(SeekBar b){}
        };
    }

    private void startMonitor() {
        if (prefs.getBoolean("enabled", true)) startForegroundService(new Intent(this, BatteryMonitorService.class));
        syncMonitoringUi();
    }
    private void test(String action) { startForegroundService(new Intent(this, BatteryMonitorService.class).setAction(action)); Toast.makeText(this,"Test alert sent",Toast.LENGTH_SHORT).show(); }
    private void requestNotifications() { if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},7); }
    private void readCurrentBattery() {
        Intent i=registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if(i!=null) {
            int l=i.getIntExtra(BatteryManager.EXTRA_LEVEL,-1),s=i.getIntExtra(BatteryManager.EXTRA_SCALE,100),st=i.getIntExtra(BatteryManager.EXTRA_STATUS,-1);
            updateBattery(Math.round(l*100f/Math.max(1,s)),st==BatteryManager.BATTERY_STATUS_CHARGING||st==BatteryManager.BATTERY_STATUS_FULL);
        }
    }
    private void updateBattery(int level, boolean charging) {
        if(level<0)return;
        percentView.setText(level+"%");
        statusView.setText(charging?"Charging now • monitoring disconnect point":"Running on battery • monitoring low level");
        percentView.setTextColor(level<=prefs.getInt("low",20)?Color.rgb(255,177,61):level>=prefs.getInt("high",85)&&charging?green:Color.WHITE);
    }
    private void openBatterySettings() {
        try { startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, android.net.Uri.parse("package:"+getPackageName()))); }
        catch(Exception e){ startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
    }
    private void toggleMonitoring() {
        boolean enabled = prefs.getBoolean("enabled", true);
        if (enabled) {
            prefs.edit().putBoolean("enabled", false).apply();
            startService(new Intent(this, BatteryMonitorService.class).setAction(BatteryMonitorService.ACTION_DISABLE));
            Toast.makeText(this, "Battery monitoring deactivated", Toast.LENGTH_SHORT).show();
        } else {
            prefs.edit().putBoolean("enabled", true).putLong("snoozeUntil", 0L).apply();
            startForegroundService(new Intent(this, BatteryMonitorService.class));
            Toast.makeText(this, "Battery monitoring active", Toast.LENGTH_SHORT).show();
        }
        syncMonitoringUi();
    }
    private void syncMonitoringUi() {
        boolean enabled = prefs.getBoolean("enabled", true);
        if (monitorButton != null) {
            monitorButton.setText(enabled ? "Deactivate monitoring" : "Activate monitoring");
            monitorButton.setBackground(round(enabled ? Color.rgb(46,55,50) : green, 18));
            monitorButton.setTextColor(enabled ? Color.WHITE : ink);
        }
        if (monitorPill != null) {
            monitorPill.setText(enabled ? "● ACTIVE" : "○ OFF");
            monitorPill.setTextColor(enabled ? green : muted);
            monitorPill.setBackground(round(enabled ? Color.rgb(14,54,37) : Color.rgb(36,45,41), 100));
        }
    }
    private String lastAlertText() {
        String last = prefs.getString("lastAlert", "");
        return last.isEmpty() ? "No alerts yet." : "Last alert: " + last;
    }
    private LinearLayout row(){ LinearLayout l=new LinearLayout(this); l.setOrientation(LinearLayout.HORIZONTAL); l.setGravity(Gravity.CENTER_VERTICAL); return l; }
    private LinearLayout card(){ LinearLayout l=new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL); l.setPadding(dp(18),dp(18),dp(18),dp(18)); l.setBackground(round(cardColor,22)); return l; }
    private TextView text(String s,int sp,int color,int style){ TextView v=new TextView(this); v.setText(s); v.setTextSize(sp); v.setTextColor(color); v.setTypeface(Typeface.create("sans",style)); v.setLineSpacing(0,1.2f); return v; }
    private Button button(String s,int bg,int fg){ Button b=new Button(this); b.setText(s); b.setTextSize(14); b.setTextColor(fg); b.setTypeface(Typeface.DEFAULT,Typeface.BOLD); b.setAllCaps(false); b.setBackground(round(bg,18)); return b; }
    private GradientDrawable round(int color,int radius){ GradientDrawable g=new GradientDrawable(); g.setColor(color); g.setCornerRadius(dp(radius)); return g; }
    private GradientDrawable roundStroke(int color,int stroke,int radius){ GradientDrawable g=round(color,radius); g.setStroke(dp(1),stroke); return g; }
    private void spacer(int h){ Space s=new Space(this); root.addView(s,new LinearLayout.LayoutParams(1,dp(h))); }
    private void spacerIn(LinearLayout l,int h){ Space s=new Space(this); l.addView(s,new LinearLayout.LayoutParams(1,dp(h))); }
    private int dp(int n){ return Math.round(n*getResources().getDisplayMetrics().density); }
}
