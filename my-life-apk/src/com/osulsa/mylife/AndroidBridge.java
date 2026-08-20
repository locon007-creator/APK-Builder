package com.osulsa.mylife;

import android.webkit.JavascriptInterface;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class AndroidBridge {
  private final MainActivity activity;
  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  AndroidBridge(MainActivity activity) { this.activity = activity; }

  @JavascriptInterface public void syncState(String json) {
    executor.execute(() -> ReminderScheduler.syncState(activity.getApplicationContext(), json));
  }

  @JavascriptInterface public void speak(String text) { activity.speakNative(text); }
  @JavascriptInterface public void stopSpeech() { activity.stopNativeSpeech(); }
  @JavascriptInterface public void pauseSpeech() { activity.stopNativeSpeech(); }
  @JavascriptInterface public boolean isSpeechAvailable() { return activity.isTtsReady(); }

  void shutdown() { executor.shutdownNow(); }
}
