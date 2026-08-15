package com.stopscore.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.animation.AlphaAnimation;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Native shell for the StopScore Driver OS web application.
 *
 * The workday, stop, and equipment logic all live in the deployed StopScore app, so this
 * activity is deliberately thin: it hosts the site in a WebView with persistent sign-in
 * cookies, a branded launch screen, and an offline state that a driver can recover from
 * without force-quitting. No location permission is requested and none is granted to the
 * page: StopScore does not use GPS.
 */
public class MainActivity extends Activity {

    /** Deployed StopScore Driver OS. */
    private static final String APP_URL = "https://stopscore-driver-os.locon007.chatgpt.site/";
    private static final int REQUEST_FILE_CHOOSER = 1001;

    private static final int BG = Color.rgb(5, 5, 5);
    private static final int SURFACE = Color.rgb(19, 19, 19);
    private static final int ACCENT = Color.rgb(255, 68, 80);
    private static final int TEXT = Color.rgb(245, 244, 239);
    private static final int MUTED = Color.rgb(170, 166, 163);

    private WebView webView;
    private ProgressBar progressBar;
    private View splashView;
    private LinearLayout errorView;
    private TextView errorTitle;
    private TextView errorMessage;

    private ValueCallback<Uri[]> fileChooserCallback;
    private boolean splashDismissed;
    private boolean loadFailed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        applySystemBarInsets(root);

        webView = new WebView(this);
        webView.setBackgroundColor(BG);
        configureWebView();
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setIndeterminate(false);
        progressBar.setProgressTintList(ColorStateList.valueOf(ACCENT));
        progressBar.setProgressBackgroundTintList(ColorStateList.valueOf(SURFACE));
        progressBar.setVisibility(View.GONE);
        root.addView(progressBar, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3), Gravity.TOP));

        errorView = buildErrorView();
        errorView.setVisibility(View.GONE);
        root.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        splashView = buildSplashView();
        root.addView(splashView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    /**
     * Android 15 forces edge-to-edge for targetSdk 35, so the shell pads itself out of the
     * status bar, navigation bar, and cutout. On older releases the decor view has already
     * consumed these insets and the reported values are zero, so the same code is correct there.
     */
    private void applySystemBarInsets(final View root) {
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Insets bars = insets.getInsets(
                            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                } else {
                    view.setPadding(
                            insets.getSystemWindowInsetLeft(),
                            insets.getSystemWindowInsetTop(),
                            insets.getSystemWindowInsetRight(),
                            insets.getSystemWindowInsetBottom());
                }
                return insets;
            }
        });
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " StopScoreAndroid/1.0.0");
        settings.setGeolocationEnabled(false);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                loadFailed = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (!loadFailed) {
                    errorView.setVisibility(View.GONE);
                    webView.setVisibility(View.VISIBLE);
                    dismissSplash();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                if (progress >= 100) {
                    progressBar.setVisibility(View.GONE);
                } else {
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(progress);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQUEST_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this, "No app available to pick a file",
                            Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                openExternally(Uri.parse(url));
            }
        });
    }

    /** Keeps web navigation (including sign-in redirects) inside the app; sends everything else out. */
    private boolean handleUrl(Uri url) {
        String scheme = url.getScheme();
        if ("http".equals(scheme) || "https".equals(scheme)) {
            return false;
        }
        openExternally(url);
        return true;
    }

    private void openExternally(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app available to open this link", Toast.LENGTH_SHORT).show();
        }
    }

    private void showError() {
        loadFailed = true;
        progressBar.setVisibility(View.GONE);
        dismissSplash();
        errorTitle.setText(isOnline() ? "StopScore is unreachable" : "You are offline");
        errorMessage.setText(isOnline()
                ? "The StopScore server did not respond. Your workday is saved on the server and will be here when the connection returns."
                : "No data or Wi-Fi connection. Reconnect and try again — nothing from your day is lost.");
        webView.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
    }

    private void retryLoad() {
        if (!isOnline()) {
            Toast.makeText(this, "Still no connection", Toast.LENGTH_SHORT).show();
            return;
        }
        loadFailed = false;
        errorView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        if (webView.getUrl() == null) {
            webView.loadUrl(APP_URL);
        } else {
            webView.reload();
        }
    }

    private boolean isOnline() {
        ConnectivityManager manager =
                (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) {
            return true;
        }
        NetworkCapabilities capabilities =
                manager.getNetworkCapabilities(manager.getActiveNetwork());
        return capabilities != null
                && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private View buildSplashView() {
        LinearLayout splash = new LinearLayout(this);
        splash.setOrientation(LinearLayout.VERTICAL);
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundColor(BG);
        splash.setClickable(true);

        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.splash_logo);
        mark.setAdjustViewBounds(true);
        splash.addView(mark, new LinearLayout.LayoutParams(
                dp(236), LinearLayout.LayoutParams.WRAP_CONTENT));

        TextView tagline = text("DRIVER OS", 11, MUTED, Typeface.BOLD);
        tagline.setLetterSpacing(0.28f);
        tagline.setPadding(0, dp(16), 0, 0);
        splash.addView(tagline);

        return splash;
    }

    private LinearLayout buildErrorView() {
        LinearLayout error = new LinearLayout(this);
        error.setOrientation(LinearLayout.VERTICAL);
        error.setGravity(Gravity.CENTER);
        error.setBackgroundColor(BG);
        error.setClickable(true);
        error.setPadding(dp(32), dp(32), dp(32), dp(32));

        errorTitle = text("You are offline", 22, TEXT, Typeface.BOLD);
        errorTitle.setGravity(Gravity.CENTER);
        error.addView(errorTitle);

        errorMessage = text("", 15, MUTED, Typeface.NORMAL);
        errorMessage.setGravity(Gravity.CENTER);
        errorMessage.setLineSpacing(dp(4), 1f);
        errorMessage.setPadding(0, dp(12), 0, dp(28));
        error.addView(errorMessage);

        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setAllCaps(false);
        retry.setTextColor(Color.WHITE);
        retry.setTypeface(Typeface.DEFAULT_BOLD);
        retry.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        GradientDrawable background = new GradientDrawable();
        background.setColor(ACCENT);
        background.setCornerRadius(dp(14));
        retry.setBackground(background);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                retryLoad();
            }
        });
        error.addView(retry, new LinearLayout.LayoutParams(dp(200), dp(52)));

        TextView host = text(Uri.parse(APP_URL).getHost(), 12, Color.rgb(113, 110, 105), Typeface.NORMAL);
        host.setGravity(Gravity.CENTER);
        host.setPadding(0, dp(20), 0, 0);
        error.addView(host);

        return error;
    }

    private TextView text(String value, int sizeSp, int color, int style) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        view.setTextColor(color);
        view.setTypeface(Typeface.create("sans-serif", style));
        return view;
    }

    private void dismissSplash() {
        if (splashDismissed || splashView == null) {
            return;
        }
        splashDismissed = true;
        AlphaAnimation fade = new AlphaAnimation(1f, 0f);
        fade.setDuration(220);
        fade.setFillAfter(true);
        splashView.startAnimation(fade);
        splashView.postDelayed(new Runnable() {
            @Override
            public void run() {
                splashView.setVisibility(View.GONE);
            }
        }, 220);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileChooserCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (errorView.getVisibility() == View.VISIBLE) {
            super.onBackPressed();
            return;
        }
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
        webView.destroy();
        super.onDestroy();
    }
}
