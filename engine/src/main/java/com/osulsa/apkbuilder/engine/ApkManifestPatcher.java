package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public final class ApkManifestPatcher {
  private ApkManifestPatcher() {}

  public static void patchIdentity(
      Path inputApk,
      Path outputApk,
      String originalPackage,
      AppIdentity identity) throws TemplateException {
    if (inputApk == null || !Files.isRegularFile(inputApk)) {
      throw new TemplateException(TemplateErrorCode.PATCH_MANIFEST_FAILED, "APK to patch is missing");
    }
    try (ZipFile input = new ZipFile(inputApk.toFile());
         AlignedZip.CountingOutputStream count = new AlignedZip.CountingOutputStream(Files.newOutputStream(outputApk));
         ZipOutputStream out = new ZipOutputStream(count)) {
      ZipEntry manifest = input.getEntry("AndroidManifest.xml");
      if (manifest == null || manifest.isDirectory()) {
        throw new TemplateException(TemplateErrorCode.PATCH_MANIFEST_FAILED, "APK has no AndroidManifest.xml");
      }
      Enumeration<? extends ZipEntry> entries = input.entries();
      boolean wroteManifest = false;
      while (entries.hasMoreElements()) {
        ZipEntry in = entries.nextElement();
        String name = in.getName();
        if (ApkHtmlInjector.isSignatureEntry(name)) continue;
        if ("AndroidManifest.xml".equals(name)) {
          byte[] before;
          try (InputStream stream = input.getInputStream(in)) { before = stream.readAllBytes(); }
          byte[] after = BinaryManifestEditor.patch(before, originalPackage, identity);
          ZipEntry replacement = new ZipEntry(name);
          replacement.setTime(AlignedZip.ZIP_TIME);
          replacement.setMethod(ZipEntry.DEFLATED);
          out.putNextEntry(replacement);
          out.write(after);
          out.closeEntry();
          wroteManifest = true;
          continue;
        }
        ZipEntry copy = AlignedZip.copyMetadata(in, count.count());
        out.putNextEntry(copy);
        if (!in.isDirectory()) {
          try (InputStream stream = input.getInputStream(in)) { stream.transferTo(out); }
        }
        out.closeEntry();
      }
      if (!wroteManifest) throw new TemplateException(TemplateErrorCode.PATCH_MANIFEST_FAILED, "Manifest patch did not run");
    } catch (TemplateException e) {
      try { Files.deleteIfExists(outputApk); } catch (IOException ignored) { }
      throw e;
    } catch (Exception e) {
      try { Files.deleteIfExists(outputApk); } catch (IOException ignored) { }
      throw new TemplateException(TemplateErrorCode.PATCH_MANIFEST_FAILED, "Could not patch APK manifest identity", e);
    }
    verifyIdentity(outputApk, identity);
  }

  public static void verifyIdentity(Path apk, AppIdentity identity) throws TemplateException {
    try (ZipFile zip = new ZipFile(apk.toFile())) {
      ZipEntry manifest = zip.getEntry("AndroidManifest.xml");
      if (manifest == null || manifest.isDirectory()) {
        throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output APK has no AndroidManifest.xml");
      }
      byte[] bytes;
      try (InputStream in = zip.getInputStream(manifest)) { bytes = in.readAllBytes(); }
      BinaryManifestEditor.verifyIdentity(bytes, identity);
    } catch (TemplateException e) {
      throw e;
    } catch (Exception e) {
      throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Could not verify output manifest identity", e);
    }
  }
}
