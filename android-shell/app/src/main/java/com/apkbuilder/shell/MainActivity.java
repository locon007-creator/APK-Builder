package com.apkbuilder.shell;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final String APP_SCHEME = "https";
    private static final String APP_HOST = "app.local";
    private static final String APP_ROOT = "www/";
    private static final String START_URL = "https://app.local/index.html";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebViewClient(new LocalAssetClient());
        webView.loadUrl(START_URL);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class LocalAssetClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isTrustedLocalUrl(uri)) {
                return false;
            }

            Intent browserIntent = new Intent(Intent.ACTION_VIEW, uri);
            try {
                startActivity(browserIntent);
            } catch (Exception ignored) {
                // Leave unsupported external URLs unopened rather than exposing them to the privileged local context.
            }
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!isTrustedLocalUrl(uri)) {
                return null;
            }
            return responseForLocalPath(uri.getPath());
        }
    }

    private boolean isTrustedLocalUrl(Uri uri) {
        return APP_SCHEME.equalsIgnoreCase(uri.getScheme())
                && APP_HOST.equalsIgnoreCase(uri.getHost());
    }

    private WebResourceResponse responseForLocalPath(String rawPath) {
        String cleanPath = normalizePath(rawPath);
        if (cleanPath == null) {
            return errorResponse(403, "Forbidden");
        }

        WebResourceResponse direct = openAsset(cleanPath);
        if (direct != null) {
            return direct;
        }

        if (!cleanPath.contains(".")) {
            WebResourceResponse spaFallback = openAsset("index.html");
            if (spaFallback != null) {
                return spaFallback;
            }
        }

        return errorResponse(404, "Not Found");
    }

    private String normalizePath(String rawPath) {
        String path = rawPath == null ? "" : Uri.decode(rawPath);
        while (path.startsWith("/")) {
            path = path.substring(1);
        }
        if (path.isEmpty()) {
            path = "index.html";
        }
        if (path.contains("..") || path.contains("\\") || path.indexOf('\0') >= 0) {
            return null;
        }
        return path;
    }

    private WebResourceResponse openAsset(String relativePath) {
        try {
            InputStream input = getAssets().open(APP_ROOT + relativePath);
            return new WebResourceResponse(mimeTypeFor(relativePath), null, input);
        } catch (IOException ignored) {
            return null;
        }
    }

    private WebResourceResponse errorResponse(int statusCode, String reason) {
        byte[] body = reason.getBytes(StandardCharsets.UTF_8);
        return new WebResourceResponse(
                "text/plain",
                "UTF-8",
                statusCode,
                reason,
                java.util.Collections.emptyMap(),
                new ByteArrayInputStream(body)
        );
    }

    private String mimeTypeFor(String path) {
        String guessed = URLConnection.guessContentTypeFromName(path);
        if (guessed != null) {
            return guessed;
        }

        String extension = MimeTypeMap.getFileExtensionFromUrl(path);
        if (!extension.isEmpty()) {
            String mapped = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase());
            if (mapped != null) {
                return mapped;
            }
        }

        if (path.endsWith(".mjs") || path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".woff")) return "font/woff";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}
