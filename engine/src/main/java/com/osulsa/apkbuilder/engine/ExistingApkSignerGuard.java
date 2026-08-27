package com.osulsa.apkbuilder.engine;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.Enumeration;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/** Ensures an update is signed with the same v1 certificate as the existing APK. */
public final class ExistingApkSignerGuard {
  private ExistingApkSignerGuard() {}

  public static String requireSameV1Signer(Path apk, X509Certificate expectedCertificate) throws TemplateException {
    if (apk == null || !Files.isRegularFile(apk)) {
      throw failed("Existing APK is missing", null);
    }
    if (expectedCertificate == null) {
      throw failed("Original signing certificate is missing", null);
    }
    try {
      ApkV1Verifier.verify(apk);
      String expected = Hashing.hex(Hashing.sha256(expectedCertificate.getEncoded()));
      boolean payloadFound = false;
      try (JarFile jar = new JarFile(apk.toFile(), true)) {
        Enumeration<JarEntry> entries = jar.entries();
        while (entries.hasMoreElements()) {
          JarEntry entry = entries.nextElement();
          if (entry.isDirectory() || entry.getName().startsWith("META-INF/")) continue;
          payloadFound = true;
          try (InputStream in = jar.getInputStream(entry)) {
            byte[] buffer = new byte[64 * 1024];
            while (in.read(buffer) >= 0) { }
          }
          Certificate[] certificates = entry.getCertificates();
          boolean matched = false;
          if (certificates != null) {
            for (Certificate certificate : certificates) {
              if (certificate instanceof X509Certificate x509) {
                String actual = Hashing.hex(Hashing.sha256(x509.getEncoded()));
                if (expected.equals(actual)) {
                  matched = true;
                  break;
                }
              }
            }
          }
          if (!matched) {
            throw failed("Signing certificate does not match the existing APK", null);
          }
        }
      }
      if (!payloadFound) throw failed("Existing APK has no signed payload", null);
      return expected;
    } catch (TemplateException e) {
      throw e;
    } catch (Exception e) {
      throw failed("Could not verify the existing APK signing certificate", e);
    }
  }

  private static TemplateException failed(String message, Throwable cause) {
    return cause == null
        ? new TemplateException(TemplateErrorCode.SIGNATURE_VERIFY_FAILED, message)
        : new TemplateException(TemplateErrorCode.SIGNATURE_VERIFY_FAILED, message, cause);
  }
}
