package com.osulsa.apkbuilder.engine;

import java.io.InputStream;
import java.nio.file.Path;
import java.security.cert.Certificate;
import java.util.Enumeration;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

public final class ApkV1Verifier {
  private ApkV1Verifier() {}
  public static void verify(Path apk) throws TemplateException {
    try (JarFile jar = new JarFile(apk.toFile(), true)) {
      Enumeration<JarEntry> entries = jar.entries(); boolean payload = false;
      while (entries.hasMoreElements()) {
        JarEntry e = entries.nextElement();
        if (e.isDirectory() || e.getName().startsWith("META-INF/")) continue;
        payload = true;
        try (InputStream in = jar.getInputStream(e)) { byte[] b = new byte[64*1024]; while (in.read(b) >= 0) {} }
        Certificate[] certs = e.getCertificates();
        if (certs == null || certs.length == 0) throw new TemplateException(TemplateErrorCode.SIGNATURE_VERIFY_FAILED, "Unsigned APK payload entry: " + e.getName());
      }
      if (!payload) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "APK has no payload entries");
    } catch (TemplateException e) { throw e; }
    catch (SecurityException e) { throw new TemplateException(TemplateErrorCode.SIGNATURE_VERIFY_FAILED, "APK signature verification failed", e); }
    catch (Exception e) { throw new TemplateException(TemplateErrorCode.SIGNATURE_VERIFY_FAILED, "Could not verify APK v1 signature", e); }
  }
}
