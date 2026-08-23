package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public final class ApkHtmlInjector {
  private ApkHtmlInjector() {}
  private static final String HTML_ENTRY = "assets/www/index.html";

  public static void injectSingleHtml(Path stagedApk, Path outputApk, byte[] html) throws TemplateException {
    try (ZipFile input = new ZipFile(stagedApk.toFile());
         AlignedZip.CountingOutputStream count = new AlignedZip.CountingOutputStream(Files.newOutputStream(outputApk));
         ZipOutputStream out = new ZipOutputStream(count)) {
      Enumeration<? extends ZipEntry> entries = input.entries();
      while (entries.hasMoreElements()) {
        ZipEntry in = entries.nextElement(); String name = in.getName();
        if (name.equals(HTML_ENTRY) || isSignatureEntry(name)) continue;
        ZipEntry copy = AlignedZip.copyMetadata(in, count.count());
        out.putNextEntry(copy); if (!in.isDirectory()) try (InputStream stream = input.getInputStream(in)) { stream.transferTo(out); } out.closeEntry();
      }
      ZipEntry htmlEntry = new ZipEntry(HTML_ENTRY); htmlEntry.setTime(AlignedZip.ZIP_TIME); htmlEntry.setMethod(ZipEntry.DEFLATED);
      out.putNextEntry(htmlEntry); out.write(html); out.closeEntry();
    } catch (Exception e) { throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Could not inject HTML into staged APK", e); }
  }

  static boolean isSignatureEntry(String name) {
    String upper = name.toUpperCase(Locale.ROOT);
    if (!upper.startsWith("META-INF/")) return false;
    String tail = upper.substring("META-INF/".length());
    return tail.equals("MANIFEST.MF") || tail.endsWith(".SF") || tail.endsWith(".RSA") || tail.endsWith(".DSA") || tail.endsWith(".EC");
  }
}
