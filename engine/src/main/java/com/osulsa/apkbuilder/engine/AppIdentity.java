package com.osulsa.apkbuilder.engine;

import java.util.regex.Pattern;

public record AppIdentity(String appName, String packageName, int versionCode, String versionName) {
  private static final Pattern PACKAGE = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+");

  public AppIdentity {
    if (appName == null || appName.isBlank() || appName.length() > 80) {
      throw new IllegalArgumentException("appName must be 1-80 characters");
    }
    if (packageName == null || !PACKAGE.matcher(packageName).matches() || packageName.length() > 200) {
      throw new IllegalArgumentException("packageName is invalid");
    }
    if (versionCode <= 0) throw new IllegalArgumentException("versionCode must be positive");
    if (versionName == null || versionName.isBlank() || versionName.length() > 64) {
      throw new IllegalArgumentException("versionName must be 1-64 characters");
    }
  }
}
