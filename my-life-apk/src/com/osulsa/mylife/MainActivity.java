package com.osulsa.mylife;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.View;
import android.webkit.*;

import java.util.Locale;

public final class MainActivity extends Activity implements TextToSpeech.OnInitListener {
  private WebView webView;
  private AndroidBridge bridge;
  private TextToSpeech tts;
  private volatile boolean ttsReady;

  @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
  @Override protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().setStatusBarColor(Color.WHITE);
    getWindow().setNavigationBarColor(Color.WHITE);
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

    NotificationHelper.ensureChannel(this);
    requestNotificationPermissionIfNeeded();
    tts = new TextToSpeech(this, this);

    webView = new WebView(this);
    setContentView(webView);
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setAllowFileAccess(true);
    settings.setAllowContentAccess(true);
    settings.setJavaScriptCanOpenWindowsAutomatically(false);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setBuiltInZoomControls(false);
    settings.setDisplayZoomControls(false);
    settings.setTextZoom(100);

    bridge = new AndroidBridge(this);
    webView.addJavascriptInterface(bridge, "AndroidBridge");
    webView.setWebChromeClient(new WebChromeClient());
    webView.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if ("file".equals(uri.getScheme())) return false;
        if ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) {
          try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
          return true;
        }
        return false;
      }
    });
    webView.loadUrl("file:///android_asset/index.html");
  }

  private void requestNotificationPermissionIfNeeded() {
    if (Build.VERSION.SDK_INT >= 33 &&
        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 3301);
    }
  }

  @Override public void onInit(int status) {
    ttsReady = status == TextToSpeech.SUCCESS;
    if (!ttsReady) return;
    int result = tts.setLanguage(Locale.getDefault());
    ttsReady = result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED;
    tts.setSpeechRate(0.95f);
    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
      @Override public void onStart(String utteranceId) {}
      @Override public void onDone(String utteranceId) { speechCallback("__myLifeNativeSpeechEnded"); }
      @Override public void onError(String utteranceId) { speechCallback("__myLifeNativeSpeechError"); }
    });
  }

  private void speechCallback(String name) {
    runOnUiThread(() -> {
      if (webView != null) webView.evaluateJavascript(
          "if(window." + name + "){window." + name + "();}", null);
    });
  }

  public boolean isTtsReady() { return ttsReady; }

  public void speakNative(String text) {
    runOnUiThread(() -> {
      if (!ttsReady || tts == null || text == null || text.trim().isEmpty()) {
        speechCallback("__myLifeNativeSpeechError");
        return;
      }
      tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "adi-guidance");
    });
  }

  public void stopNativeSpeech() {
    runOnUiThread(() -> { if (tts != null) tts.stop(); });
  }

  @Override public void onBackPressed() {
    if (webView != null && webView.canGoBack()) webView.goBack();
    else super.onBackPressed();
  }

  @Override protected void onDestroy() {
    if (bridge != null) bridge.shutdown();
    if (webView != null) {
      webView.removeJavascriptInterface("AndroidBridge");
      webView.destroy();
    }
    if (tts != null) { tts.stop(); tts.shutdown(); }
    super.onDestroy();
  }
}
