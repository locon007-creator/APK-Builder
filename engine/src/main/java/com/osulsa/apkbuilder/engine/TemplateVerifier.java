package com.osulsa.apkbuilder.engine;

import java.nio.file.*;
import java.util.zip.ZipException;
import java.util.zip.ZipFile;

public final class TemplateVerifier {
  private TemplateVerifier() {}

  public static VerifiedTemplate verify(Path apk, TemplateContract contract, String builderVersion) throws TemplateException {
    if (contract == null) throw new TemplateException(TemplateErrorCode.TEMPLATE_CONTRACT_MISSING, "Template contract missing");
    if (apk == null || !Files.isRegularFile(apk)) throw new TemplateException(TemplateErrorCode.TEMPLATE_MISSING_INTERNAL, "Bundled template missing");
    try {
      if (Files.size(apk) <= 0) throw new TemplateException(TemplateErrorCode.TEMPLATE_MISSING_INTERNAL, "Bundled template is empty");
      String actual = Hashing.sha256(apk);
      if (!actual.equalsIgnoreCase(contract.sha256())) throw new TemplateException(TemplateErrorCode.TEMPLATE_CHECKSUM_MISMATCH, "Bundled template checksum mismatch");
      if (compareVersions(builderVersion, contract.minimumBuilderVersion()) < 0) throw new TemplateException(TemplateErrorCode.TEMPLATE_INCOMPATIBLE, "Builder is older than template minimum");
      try (ZipFile zip = new ZipFile(apk.toFile())) {
        for (String entry : contract.requiredEntries()) if (zip.getEntry(entry) == null) throw new TemplateException(TemplateErrorCode.TEMPLATE_CORRUPT, "Template missing required APK entry: " + entry);
      }
      return new VerifiedTemplate(apk.toAbsolutePath().normalize(), contract, actual);
    } catch (TemplateException e) {
      throw e;
    } catch (ZipException e) {
      throw new TemplateException(TemplateErrorCode.TEMPLATE_CORRUPT, "Template is not a valid APK ZIP", e);
    } catch (Exception e) {
      throw new TemplateException(TemplateErrorCode.TEMPLATE_CORRUPT, "Template verification failed", e);
    }
  }

  static int compareVersions(String a, String b) throws TemplateException {
    try {
      String[] aa = a.split("[.-]"); String[] bb = b.split("[.-]"); int n = Math.max(aa.length, bb.length);
      for (int i=0;i<n;i++) { int x = i<aa.length ? Integer.parseInt(aa[i].replaceAll("\\D.*$", "")) : 0; int y = i<bb.length ? Integer.parseInt(bb[i].replaceAll("\\D.*$", "")) : 0; if (x != y) return Integer.compare(x,y); }
      return 0;
    } catch (Exception e) { throw new TemplateException(TemplateErrorCode.TEMPLATE_CONTRACT_INVALID, "Invalid version", e); }
  }
}
