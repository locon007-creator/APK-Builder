package com.osulsa.apkbuilder.engine;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;

public final class Hashing {
  private Hashing() {}
  public static String sha256(Path path) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream in = Files.newInputStream(path)) {
      byte[] buffer = new byte[64 * 1024];
      for (int read; (read = in.read(buffer)) >= 0;) {
        if (read > 0) digest.update(buffer, 0, read);
      }
    }
    return hex(digest.digest());
  }
  public static byte[] sha256(byte[] bytes) throws Exception {
    return MessageDigest.getInstance("SHA-256").digest(bytes);
  }
  public static String hex(byte[] bytes) {
    StringBuilder sb = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) sb.append(String.format("%02x", b & 0xff));
    return sb.toString();
  }
}
