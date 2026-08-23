package com.osulsa.apkbuilder.engine;

final class ShellConfigFactory {
  private ShellConfigFactory() {}

  static byte[] singleHtml(String packageName) {
    return singleHtml(packageName, "index.html");
  }

  static byte[] singleHtml(String packageName, String entryFile) {
    String safePackage = escape(packageName);
    String safeEntry = escape(entryFile);
    String json = "{" +
        "\"schemaVersion\":1," +
        "\"appName\":\"Generated App\"," +
        "\"packageName\":\"" + safePackage + "\"," +
        "\"targetUrl\":\"\"," +
        "\"htmlUsesFileScheme\":false," +
        "\"loggingEnabled\":false," +
        "\"versionCode\":1," +
        "\"versionName\":\"1.0.0\"," +
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
          "\"enableNativeBridge\":false" +
        "}," +
        "\"appType\":\"HTML\"," +
        "\"siteAssetBase\":\"html\"," +
        "\"htmlConfig\":{" +
          "\"entryFile\":\"" + safeEntry + "\"," +
          "\"enableJavaScript\":true," +
          "\"enableLocalStorage\":true" +
        "}" +
      "}";
    return json.getBytes(java.nio.charset.StandardCharsets.UTF_8);
  }

  private static String escape(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"");
  }
}
