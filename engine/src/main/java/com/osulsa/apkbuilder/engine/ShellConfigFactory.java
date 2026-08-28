package com.osulsa.apkbuilder.engine;

final class ShellConfigFactory {
  private ShellConfigFactory() {}

  static byte[] singleHtml(String packageName) {
    return singleHtml(new AppIdentity("Generated App", packageName, 1, "1.0.0"), "index.html");
  }

  static byte[] singleHtml(String packageName, String entryFile) {
    return singleHtml(new AppIdentity("Generated App", packageName, 1, "1.0.0"), entryFile);
  }

  static byte[] singleHtml(AppIdentity identity) {
    return singleHtml(identity, "index.html");
  }

  static byte[] singleHtml(AppIdentity identity, String entryFile) {
    String json = "{" +
        "\"schemaVersion\":1," +
        "\"appName\":\"" + escape(identity.appName()) + "\"," +
        "\"packageName\":\"" + escape(identity.packageName()) + "\"," +
        "\"targetUrl\":\"\"," +
        "\"htmlUsesFileScheme\":false," +
        "\"loggingEnabled\":false," +
        "\"versionCode\":" + identity.versionCode() + "," +
        "\"versionName\":\"" + escape(identity.versionName()) + "\"," +
        "\"activationEnabled\":false," +
        "\"adBlockEnabled\":false," +
        "\"announcementEnabled\":false," +
        "\"adsEnabled\":false," +
        "\"splashEnabled\":false," +
        "\"webViewConfig\":{" +
          "\"javaScriptEnabled\":true," +
          "\"domStorageEnabled\":true," +
          "\"allowFileAccess\":false," +
          "\"allowContentAccess\":false," +
          "\"hideToolbar\":true," +
          "\"hideBrowserToolbar\":true," +
          "\"toolbarShowTitle\":false," +
          "\"toolbarShowUrl\":false," +
          "\"toolbarShowBack\":false," +
          "\"toolbarShowForward\":false," +
          "\"toolbarShowRefresh\":false," +
          "\"browserToolbarCustomized\":true," +
          "\"enableNativeBridge\":false" +
        "}," +
        "\"appType\":\"HTML\"," +
        "\"siteAssetBase\":\"html\"," +
        "\"htmlConfig\":{" +
          "\"entryFile\":\"" + escape(entryFile) + "\"," +
          "\"enableJavaScript\":true," +
          "\"enableLocalStorage\":true" +
        "}" +
      "}";
    return json.getBytes(java.nio.charset.StandardCharsets.UTF_8);
  }

  private static String escape(String value) {
    StringBuilder out = new StringBuilder(value.length() + 8);
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\b' -> out.append("\\b");
        case '\f' -> out.append("\\f");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> {
          if (c < 0x20) out.append(String.format(java.util.Locale.ROOT, "\\u%04x", (int)c));
          else out.append(c);
        }
      }
    }
    return out.toString();
  }
}
