package com.osulsa.apkbuilder.engine;

import java.nio.charset.StandardCharsets;

public final class ShellConfigFactorySelfTest {
  public static void main(String[] args) {
    String config = new String(
        ShellConfigFactory.singleHtml(new AppIdentity("Audit App", "com.example.audit", 7, "7.0.0"), "nested/index.html"),
        StandardCharsets.UTF_8);

    require(config.contains("\"hideToolbar\":true"), "shell toolbar must be hidden");
    require(config.contains("\"hideBrowserToolbar\":true"), "browser toolbar must be hidden");
    require(config.contains("\"toolbarShowTitle\":false"), "browser title must be hidden");
    require(config.contains("\"toolbarShowUrl\":false"), "browser URL must be hidden");
    require(config.contains("\"toolbarShowBack\":false"), "browser back must be hidden");
    require(config.contains("\"toolbarShowForward\":false"), "browser forward must be hidden");
    require(config.contains("\"toolbarShowRefresh\":false"), "browser refresh must be hidden");
    require(config.contains("\"browserToolbarCustomized\":true"), "toolbar hidden state must be explicit");
    require(config.contains("\"enableNativeBridge\":false"), "native bridge remains disabled by default");
    require(config.contains("\"entryFile\":\"nested/index.html\""), "entry point preserved");

    System.out.println("SHELL_CONFIG_FACTORY_SELF_TEST_PASS");
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
}
