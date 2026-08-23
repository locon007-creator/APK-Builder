package com.osulsa.apkbuilder.engine;

import java.nio.file.*;
import java.util.UUID;

public final class ApkStager {
  private ApkStager() {}
  public static Path createAttempt(VerifiedTemplate verified, Path attemptsRoot) throws TemplateException {
    try {
      Path dir = attemptsRoot.resolve(UUID.randomUUID().toString());
      Files.createDirectories(dir);
      Path staged = dir.resolve("template-working.apk");
      Files.copy(verified.source(), staged, StandardCopyOption.COPY_ATTRIBUTES);
      if (!Hashing.sha256(staged).equalsIgnoreCase(verified.sha256())) throw new TemplateException(TemplateErrorCode.TEMPLATE_CHECKSUM_MISMATCH, "Staging copy checksum changed");
      return staged;
    } catch (TemplateException e) { throw e; }
    catch (Exception e) { throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Could not create isolated build attempt", e); }
  }
}
