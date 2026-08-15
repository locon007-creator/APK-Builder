package com.chargeguard.app;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;

public class MainActivity extends Activity {
    private static final int PICK_LOW_SYSTEM=101,PICK_HIGH_SYSTEM=102,PICK_LOW_CUSTOM=201,PICK_HIGH_CUSTOM=202;
    private final int bg=Color.rgb(6,14,10),surface=Color.rgb(15,29,22),surface2=Color.rgb(20,39,29);
    private final int emerald=Color.rgb(56,226,141),white=Color.rgb(244,247,245),muted=Color.rgb(148,162,155);
    private final int amber=Color.rgb(242,180,76),danger=Color.rgb(169,70,70);
    private LinearLayout root;
    private android.content.SharedPreferences prefs;
    private BatteryRingView batteryRing;
    private TextView statusPill,lowLabel,highLabel,rangeSummary,lowSoundLabel,highSoundLabel,lastAlertLabel;
    private Button monitorButton;
    private int currentLevel=0;
    private boolean currentCharging=false;
    private Ringtone preview;

    private final BroadcastReceiver statusReceiver=new BroadcastReceiver(){
        @Override public void onReceive(Context c,Intent i){updateBattery(i.getIntExtra("level",currentLevel),i.getBooleanExtra("charging",currentCharging));}
    };

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        prefs=getSharedPreferences("chargeguard",MODE_PRIVATE);
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);
        buildUi();
        requestNotifications();
        if(prefs.getBoolean("enabled",true))startForegroundService(new Intent(this,BatteryMonitorService.class));
        readCurrentBattery();
    }

    @Override protected void onStart(){
        super.onStart();
        if(Build.VERSION.SDK_INT>=33)registerReceiver(statusReceiver,new IntentFilter("com.chargeguard.STATUS"),RECEIVER_NOT_EXPORTED);
        else registerReceiver(statusReceiver,new IntentFilter("com.chargeguard.STATUS"));
        refreshAll();
    }

    @Override protected void onStop(){
        try{unregisterReceiver(statusReceiver);}catch(Exception ignored){}
        stopPreview();
        super.onStop();
    }

    private void buildUi(){
        ScrollView scroll=new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(bg);
        root=new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20),dp(18),dp(20),dp(40));
        scroll.addView(root);
        buildHeader();spacer(18);buildHero();spacer(16);buildRangeCard();spacer(16);buildThresholdCard();spacer(16);buildSoundCard();spacer(16);buildActionsCard();spacer(16);buildReliabilityCard();
        setContentView(scroll);
    }

    private void buildHeader(){
        LinearLayout row=horizontal(),titles=vertical();
        TextView brand=text("ChargeGuard",23,white,Typeface.BOLD);
        TextView subtitle=text("BATTERY PROTECTION",10,muted,Typeface.BOLD);subtitle.setLetterSpacing(.18f);
        titles.addView(brand);titles.addView(subtitle);
        row.addView(titles,new LinearLayout.LayoutParams(0,dp(54),1));
        statusPill=text("● PROTECTED",11,emerald,Typeface.BOLD);statusPill.setGravity(Gravity.CENTER);statusPill.setBackground(round(Color.rgb(14,55,36),99));statusPill.setOnClickListener(v->toggleMonitoring());
        row.addView(statusPill,new LinearLayout.LayoutParams(dp(124),dp(42)));
        root.addView(row);
    }

    private void buildHero(){
        LinearLayout hero=vertical();hero.setGravity(Gravity.CENTER);hero.setPadding(dp(12),dp(14),dp(12),dp(14));
        GradientDrawable heroBg=new GradientDrawable(GradientDrawable.Orientation.TL_BR,new int[]{Color.rgb(11,35,24),Color.rgb(7,18,13),Color.rgb(12,27,20)});
        heroBg.setCornerRadius(dp(30));heroBg.setStroke(dp(1),Color.rgb(29,67,48));hero.setBackground(heroBg);hero.setElevation(dp(8));
        batteryRing=new BatteryRingView(this);hero.addView(batteryRing,new LinearLayout.LayoutParams(-1,dp(300)));
        TextView hint=text("Live protection continues when this screen is closed",12,muted,Typeface.NORMAL);hint.setGravity(Gravity.CENTER);hint.setPadding(dp(8),0,dp(8),dp(8));hero.addView(hint);
        root.addView(hero);
    }

    private void buildRangeCard(){
        LinearLayout card=card(),top=horizontal();
        top.addView(sectionTitle("SMART CHARGE WINDOW"),new LinearLayout.LayoutParams(0,dp(36),1));
        TextView ideal=text("OPTIMIZED",10,emerald,Typeface.BOLD);ideal.setGravity(Gravity.CENTER);ideal.setBackground(round(Color.rgb(14,55,36),99));top.addView(ideal,new LinearLayout.LayoutParams(dp(90),dp(30)));card.addView(top);
        rangeSummary=text("",19,white,Typeface.BOLD);rangeSummary.setPadding(0,dp(5),0,dp(16));card.addView(rangeSummary);
        View rail=new View(this);rail.setBackground(round(Color.rgb(37,78,57),99));card.addView(rail,new LinearLayout.LayoutParams(-1,dp(8)));
        LinearLayout stats=horizontal();stats.setPadding(0,dp(15),0,0);
        stats.addView(metric("CHARGE AT",prefs.getInt("low",20)+"%",amber),new LinearLayout.LayoutParams(0,dp(60),1));
        View divider=new View(this);divider.setBackgroundColor(Color.rgb(49,70,59));stats.addView(divider,new LinearLayout.LayoutParams(dp(1),dp(50)));
        stats.addView(metric("UNPLUG AT",prefs.getInt("high",85)+"%",emerald),new LinearLayout.LayoutParams(0,dp(60),1));card.addView(stats);root.addView(card);
    }

    private void buildThresholdCard(){
        LinearLayout card=card();card.addView(sectionTitle("ALERT LEVELS"));
        lowLabel=text("",16,white,Typeface.BOLD);lowLabel.setPadding(0,dp(15),0,0);card.addView(lowLabel);
        SeekBar low=seek(25,prefs.getInt("low",20)-10,amber);low.setOnSeekBarChangeListener(seekListener(true));card.addView(low);
        highLabel=text("",16,white,Typeface.BOLD);highLabel.setPadding(0,dp(12),0,0);card.addView(highLabel);
        SeekBar high=seek(20,prefs.getInt("high",85)-75,emerald);high.setOnSeekBarChangeListener(seekListener(false));card.addView(high);root.addView(card);
    }

    private void buildSoundCard(){
        LinearLayout card=card();card.addView(sectionTitle("ALERT EXPERIENCE"));
        TextView desc=text("Choose any Samsung sound, ringtone, or audio file on your phone.",13,muted,Typeface.NORMAL);desc.setPadding(0,dp(6),0,dp(16));card.addView(desc);
        card.addView(soundRow(false));spacerIn(card,10);card.addView(soundRow(true));spacerIn(card,12);
        LinearLayout toggles=horizontal();
        Switch sound=toggle("Sound",prefs.getBoolean("soundEnabled",true));sound.setOnCheckedChangeListener((b,c)->prefs.edit().putBoolean("soundEnabled",c).apply());
        Switch vibration=toggle("Vibrate",prefs.getBoolean("vibrationEnabled",true));vibration.setOnCheckedChangeListener((b,c)->prefs.edit().putBoolean("vibrationEnabled",c).apply());
        toggles.addView(sound,new LinearLayout.LayoutParams(0,dp(54),1));toggles.addView(vibration,new LinearLayout.LayoutParams(0,dp(54),1));card.addView(toggles);
        TextView durationTitle=text("Alarm duration",13,muted,Typeface.BOLD);durationTitle.setPadding(0,dp(8),0,dp(6));card.addView(durationTitle);
        Spinner duration=new Spinner(this);String[] durations={"15 seconds","30 seconds","60 seconds","Until stopped"};
        ArrayAdapter<String> adapter=new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,durations){
            @Override public View getView(int p,View v,ViewGroup parent){TextView t=(TextView)super.getView(p,v,parent);t.setTextColor(white);t.setTextSize(15);t.setPadding(dp(12),dp(10),dp(12),dp(10));return t;}
        };
        duration.setAdapter(adapter);int saved=prefs.getInt("alarmDuration",15);duration.setSelection(saved==30?1:saved==60?2:saved==0?3:0);
        duration.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?> p,View v,int pos,long id){prefs.edit().putInt("alarmDuration",new int[]{15,30,60,0}[pos]).apply();}public void onNothingSelected(AdapterView<?> p){}});
        card.addView(duration,new LinearLayout.LayoutParams(-1,dp(52)));root.addView(card);
    }

    private View soundRow(boolean high){
        LinearLayout wrap=vertical();wrap.setPadding(dp(14),dp(14),dp(14),dp(12));wrap.setBackground(round(surface2,18));
        TextView title=text(high?"DISCONNECT CHARGER":"CHARGE NOW",11,high?emerald:amber,Typeface.BOLD);title.setLetterSpacing(.12f);wrap.addView(title);
        TextView label=text("",17,white,Typeface.BOLD);label.setPadding(0,dp(5),0,dp(10));if(high)highSoundLabel=label;else lowSoundLabel=label;wrap.addView(label);
        LinearLayout buttons=horizontal();Button choose=smallButton("Choose sound",Color.rgb(40,59,49),white);choose.setOnClickListener(v->showSoundMenu(high));Button previewButton=smallButton("Preview",emerald,bg);previewButton.setOnClickListener(v->previewSound(high));
        buttons.addView(choose,new LinearLayout.LayoutParams(0,dp(48),1));Space gap=new Space(this);buttons.addView(gap,new LinearLayout.LayoutParams(dp(8),1));buttons.addView(previewButton,new LinearLayout.LayoutParams(0,dp(48),1));wrap.addView(buttons);return wrap;
    }

    private void buildActionsCard(){
        LinearLayout card=card();card.addView(sectionTitle("QUICK CONTROLS"));spacerIn(card,12);
        LinearLayout tests=horizontal();Button low=smallButton("Test charge alert",Color.rgb(48,57,52),white);low.setOnClickListener(v->testAlert(false));Button high=smallButton("Test unplug alert",emerald,bg);high.setOnClickListener(v->testAlert(true));
        tests.addView(low,new LinearLayout.LayoutParams(0,dp(52),1));Space g=new Space(this);tests.addView(g,new LinearLayout.LayoutParams(dp(8),1));tests.addView(high,new LinearLayout.LayoutParams(0,dp(52),1));card.addView(tests);spacerIn(card,10);
        LinearLayout quiet=horizontal();Button stop=smallButton("Stop alarm",danger,white);stop.setOnClickListener(v->sendServiceAction(BatteryMonitorService.ACTION_STOP_ALARM,"Alarm stopped"));Button snooze=smallButton("Snooze 30 min",Color.rgb(40,59,49),white);snooze.setOnClickListener(v->sendServiceAction(BatteryMonitorService.ACTION_SNOOZE,"Alerts snoozed for 30 minutes"));
        quiet.addView(stop,new LinearLayout.LayoutParams(0,dp(52),1));Space g2=new Space(this);quiet.addView(g2,new LinearLayout.LayoutParams(dp(8),1));quiet.addView(snooze,new LinearLayout.LayoutParams(0,dp(52),1));card.addView(quiet);spacerIn(card,10);
        monitorButton=button("Deactivate protection",Color.rgb(40,59,49),white);monitorButton.setOnClickListener(v->toggleMonitoring());card.addView(monitorButton,new LinearLayout.LayoutParams(-1,dp(56)));root.addView(card);
    }

    private void buildReliabilityCard(){
        LinearLayout card=card();card.addView(sectionTitle("SAMSUNG RELIABILITY"));
        TextView copy=text("Allow unrestricted battery use so ChargeGuard can alert you while the app is closed.",13,muted,Typeface.NORMAL);copy.setPadding(0,dp(7),0,dp(14));card.addView(copy);
        Button settings=button("Open battery settings",Color.TRANSPARENT,white);settings.setBackground(roundStroke(surface,Color.rgb(56,82,68),18));settings.setOnClickListener(v->openBatterySettings());card.addView(settings,new LinearLayout.LayoutParams(-1,dp(54)));
        lastAlertLabel=text("",12,muted,Typeface.NORMAL);lastAlertLabel.setPadding(0,dp(14),0,0);card.addView(lastAlertLabel);root.addView(card);
    }

    private void showSoundMenu(boolean high){
        String[] items={"Samsung & Android sounds","Choose custom audio file","Use default alarm"};
        new AlertDialog.Builder(this).setTitle(high?"Disconnect charger sound":"Charge now sound").setItems(items,(d,which)->{
            if(which==0){Intent i=new Intent(RingtoneManager.ACTION_RINGTONE_PICKER);i.putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE,RingtoneManager.TYPE_ALL);i.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT,true);i.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT,false);startActivityForResult(i,high?PICK_HIGH_SYSTEM:PICK_LOW_SYSTEM);}
            else if(which==1){Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("audio/*");startActivityForResult(i,high?PICK_HIGH_CUSTOM:PICK_LOW_CUSTOM);}
            else saveSound(high,null);
        }).show();
    }

    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);if(resultCode!=RESULT_OK||data==null)return;
        boolean high=requestCode==PICK_HIGH_SYSTEM||requestCode==PICK_HIGH_CUSTOM;Uri uri;
        if(requestCode==PICK_LOW_SYSTEM||requestCode==PICK_HIGH_SYSTEM)uri=data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
        else{uri=data.getData();if(uri!=null)try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(Exception ignored){}}
        saveSound(high,uri);
    }

    private void saveSound(boolean high,Uri uri){String key=high?"highSoundUri":"lowSoundUri";prefs.edit().putString(key,uri==null?"":uri.toString()).apply();refreshSoundLabels();previewSound(high);}
    private void previewSound(boolean high){stopPreview();Uri uri=SoundSelection.resolve(this,prefs,high);try{preview=RingtoneManager.getRingtone(this,uri);if(preview!=null){preview.play();new Handler(Looper.getMainLooper()).postDelayed(this::stopPreview,8000);}}catch(Exception e){Toast.makeText(this,"Sound unavailable — choose another sound",Toast.LENGTH_LONG).show();}}
    private void stopPreview(){if(preview!=null&&preview.isPlaying())preview.stop();preview=null;}
    private void testAlert(boolean high){if(!prefs.getBoolean("enabled",true)){Toast.makeText(this,"Activate protection first",Toast.LENGTH_SHORT).show();return;}startForegroundService(new Intent(this,BatteryMonitorService.class).setAction(high?"TEST_HIGH":"TEST_LOW"));Toast.makeText(this,"Test alert sent",Toast.LENGTH_SHORT).show();}
    private void sendServiceAction(String action,String message){if(prefs.getBoolean("enabled",true))startService(new Intent(this,BatteryMonitorService.class).setAction(action));Toast.makeText(this,message,Toast.LENGTH_SHORT).show();}

    private void toggleMonitoring(){
        boolean enabled=prefs.getBoolean("enabled",true);
        if(enabled){prefs.edit().putBoolean("enabled",false).apply();startService(new Intent(this,BatteryMonitorService.class).setAction(BatteryMonitorService.ACTION_DISABLE));}
        else{prefs.edit().putBoolean("enabled",true).putLong("snoozeUntil",0L).apply();startForegroundService(new Intent(this,BatteryMonitorService.class));}
        refreshAll();Toast.makeText(this,enabled?"Protection deactivated":"Protection active",Toast.LENGTH_SHORT).show();
    }

    private SeekBar.OnSeekBarChangeListener seekListener(boolean low){return new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar b,int p,boolean user){prefs.edit().putInt(low?"low":"high",(low?10:75)+p).apply();refreshThresholds();}public void onStartTrackingTouch(SeekBar b){}public void onStopTrackingTouch(SeekBar b){}};}
    private void refreshAll(){refreshThresholds();refreshSoundLabels();refreshMonitoring();if(lastAlertLabel!=null){String last=prefs.getString("lastAlert","");lastAlertLabel.setText(last.isEmpty()?"No alerts yet.":"Last alert • "+last);}}
    private void refreshThresholds(){int low=prefs.getInt("low",20),high=prefs.getInt("high",85);if(lowLabel!=null)lowLabel.setText("Charge me at "+low+"%");if(highLabel!=null)highLabel.setText("Disconnect at "+high+"%");if(rangeSummary!=null)rangeSummary.setText("Protected between "+low+"% and "+high+"%");if(batteryRing!=null)batteryRing.setBattery(currentLevel,currentCharging,low,high,prefs.getBoolean("enabled",true));}
    private void refreshSoundLabels(){if(lowSoundLabel!=null)lowSoundLabel.setText(SoundSelection.label(this,prefs.getString("lowSoundUri","")));if(highSoundLabel!=null)highSoundLabel.setText(SoundSelection.label(this,prefs.getString("highSoundUri","")));}
    private void refreshMonitoring(){boolean e=prefs.getBoolean("enabled",true);if(statusPill!=null){statusPill.setText(e?"● PROTECTED":"○ MONITORING OFF");statusPill.setTextColor(e?emerald:muted);statusPill.setBackground(round(e?Color.rgb(14,55,36):Color.rgb(38,48,43),99));}if(monitorButton!=null){monitorButton.setText(e?"Deactivate protection":"Activate protection");monitorButton.setTextColor(e?white:bg);monitorButton.setBackground(round(e?Color.rgb(40,59,49):emerald,18));}if(batteryRing!=null)batteryRing.setBattery(currentLevel,currentCharging,prefs.getInt("low",20),prefs.getInt("high",85),e);}
    private void readCurrentBattery(){Intent i=registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));if(i!=null){int l=i.getIntExtra(BatteryManager.EXTRA_LEVEL,0),s=i.getIntExtra(BatteryManager.EXTRA_SCALE,100),st=i.getIntExtra(BatteryManager.EXTRA_STATUS,-1);updateBattery(Math.round(l*100f/Math.max(1,s)),st==BatteryManager.BATTERY_STATUS_CHARGING||st==BatteryManager.BATTERY_STATUS_FULL);}}
    private void updateBattery(int level,boolean charging){currentLevel=level;currentCharging=charging;if(batteryRing!=null)batteryRing.setBattery(level,charging,prefs.getInt("low",20),prefs.getInt("high",85),prefs.getBoolean("enabled",true));}
    private void requestNotifications(){if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},7);}
    private void openBatterySettings(){try{startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,Uri.parse("package:"+getPackageName())));}catch(Exception e){startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));}}

    private LinearLayout vertical(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;}
    private LinearLayout horizontal(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.HORIZONTAL);l.setGravity(Gravity.CENTER_VERTICAL);return l;}
    private LinearLayout card(){LinearLayout l=vertical();l.setPadding(dp(18),dp(18),dp(18),dp(18));l.setBackground(round(surface,24));l.setElevation(dp(3));return l;}
    private TextView sectionTitle(String s){TextView t=text(s,11,muted,Typeface.BOLD);t.setLetterSpacing(.16f);return t;}
    private LinearLayout metric(String label,String value,int color){LinearLayout l=vertical();l.setGravity(Gravity.CENTER);TextView a=text(label,10,muted,Typeface.BOLD);a.setGravity(Gravity.CENTER);l.addView(a);TextView v=text(value,23,color,Typeface.BOLD);v.setGravity(Gravity.CENTER);l.addView(v);return l;}
    private TextView text(String s,int sp,int color,int style){TextView v=new TextView(this);v.setText(s);v.setTextSize(sp);v.setTextColor(color);v.setTypeface(Typeface.create("sans-serif",style));v.setLineSpacing(0,1.18f);return v;}
    private Button button(String s,int color,int textColor){Button b=new Button(this);b.setText(s);b.setTextSize(14);b.setTextColor(textColor);b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);b.setAllCaps(false);b.setBackground(round(color,18));b.setStateListAnimator(null);return b;}
    private Button smallButton(String s,int color,int textColor){Button b=button(s,color,textColor);b.setTextSize(12);return b;}
    private Switch toggle(String s,boolean checked){Switch sw=new Switch(this);sw.setText(s);sw.setTextSize(14);sw.setTextColor(white);sw.setChecked(checked);return sw;}
    private SeekBar seek(int max,int progress,int tint){SeekBar b=new SeekBar(this);b.setMax(max);b.setProgress(progress);b.setProgressTintList(ColorStateList.valueOf(tint));b.setThumbTintList(ColorStateList.valueOf(tint));b.setMinHeight(dp(48));return b;}
    private GradientDrawable round(int color,int radius){GradientDrawable g=new GradientDrawable();g.setColor(color);g.setCornerRadius(dp(radius));return g;}
    private GradientDrawable roundStroke(int color,int stroke,int radius){GradientDrawable g=round(color,radius);g.setStroke(dp(1),stroke);return g;}
    private void spacer(int h){Space s=new Space(this);root.addView(s,new LinearLayout.LayoutParams(1,dp(h)));}
    private void spacerIn(LinearLayout l,int h){Space s=new Space(this);l.addView(s,new LinearLayout.LayoutParams(1,dp(h)));}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
}
