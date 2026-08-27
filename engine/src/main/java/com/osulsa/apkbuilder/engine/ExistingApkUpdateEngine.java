package com.osulsa.apkbuilder.engine;

import java.io.InputStream;
import java.nio.file.*;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** Complete prepared-project update path for APKs created with APK Builder's v1 signer. */
public final class ExistingApkUpdateEngine {
  private ExistingApkUpdateEngine() {}

  public record UpdateEvidence(
      String attemptId,
      String packageName,
      int previousVersionCode,
      int newVersionCode,
      int projectFileCount,
      String signerCertificateSha256,
      String existingApkSha256,
      String outputApkSha256,
      Instant completedAt) {}

  public static UpdateEvidence updatePreparedProject(
      Path existingApk,
      Path projectRoot,
      List<String> projectFiles,
      String entryFile,
      Path attemptsRoot,
      PrivateKey signingKey,
      X509Certificate signingCertificate,
      Path verifiedOutput) throws TemplateException {
    if (signingKey == null || signingCertificate == null) {
      throw new TemplateException(TemplateErrorCode.SIGNATURE_VERIFY_FAILED, "Original signing key and certificate are required for an app update");
    }
    if (attemptsRoot == null) {
      throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Update attempts directory is missing");
    }

    String signerHash = ExistingApkSignerGuard.requireSameV1Signer(existingApk, signingCertificate);
    String existingHash;
    try {
      existingHash = Hashing.sha256(existingApk);
    } catch (Exception e) {
      throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Could not hash existing APK", e);
    }

    String attemptId = "update-" + UUID.randomUUID();
    Path attempt = attemptsRoot.toAbsolutePath().normalize().resolve(attemptId);
    Path unsigned = attempt.resolve("updated-unsigned.apk");
    Path signed = attempt.resolve("updated-signed.apk");

    try {
      Files.createDirectories(attempt);
      ExistingApkWebUpdater.UpdateResult update = ExistingApkWebUpdater.prepareUnsigned(
          existingApk, projectRoot, projectFiles, entryFile, unsigned);
      ZipAlignmentVerifier.verify(unsigned);

      V1ApkSigner.sign(unsigned, signed, signingKey, signingCertificate, "CERT");
      ZipAlignmentVerifier.verify(signed);
      ApkV1Verifier.verify(signed);
      ExistingApkSignerGuard.requireSameV1Signer(signed, signingCertificate);
      verifyIdentityAndProject(signed, update, projectRoot, projectFiles);

      AtomicApkPublisher.publish(signed, verifiedOutput, candidate -> {
        ZipAlignmentVerifier.verify(candidate);
        ApkV1Verifier.verify(candidate);
        ExistingApkSignerGuard.requireSameV1Signer(candidate, signingCertificate);
        verifyIdentityAndProject(candidate, update, projectRoot, projectFiles);
      });

      String outputHash = Hashing.sha256(verifiedOutput);
      UpdateEvidence evidence = new UpdateEvidence(
          attemptId,
          update.packageName(),
          update.previousVersionCode(),
          update.newVersionCode(),
          update.projectFileCount(),
          signerHash,
          existingHash,
          outputHash,
          Instant.now());
      Files.writeString(attempt.resolve("update-evidence.json"), toJson(evidence));
      return evidence;
    } catch (TemplateException e) {
      throw e;
    } catch (Exception e) {
      throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Existing APK update failed", e);
    }
  }

  private static void verifyIdentityAndProject(
      Path apk,
      ExistingApkWebUpdater.UpdateResult expected,
      Path projectRoot,
      List<String> projectFiles) throws Exception {
    try (ZipFile zip = new ZipFile(apk.toFile())) {
      ZipEntry manifest = zip.getEntry("AndroidManifest.xml");
      if (manifest == null || manifest.isDirectory()) {
        throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Updated APK is missing AndroidManifest.xml");
      }
      BinaryManifestVersionBumper.ManifestInfo info;
      try (InputStream in = zip.getInputStream(manifest)) {
        info = BinaryManifestVersionBumper.inspect(in.readAllBytes());
      }
      if (!expected.packageName().equals(info.packageName()) || expected.newVersionCode() != info.versionCode()) {
        throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Updated APK package/version verification failed");
      }

      Path root = projectRoot.toAbsolutePath().normalize();
      for (String raw : projectFiles) {
        String relative = raw.replace('\\', '/');
        Path source = root.resolve(relative.replace('/', java.io.File.separatorChar)).normalize();
        ZipEntry entry = zip.getEntry("assets/html/" + relative);
        if (entry == null || entry.isDirectory()) {
          throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Updated APK is missing project file: " + relative);
        }
        byte[] expectedBytes = Files.readAllBytes(source);
        byte[] actual;
        try (InputStream in = zip.getInputStream(entry)) { actual = in.readAllBytes(); }
        if (!java.util.Arrays.equals(expectedBytes, actual)) {
          throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Updated APK project file differs from input: " + relative);
        }
      }
    }
  }

  private static String toJson(UpdateEvidence e) {
    return "{" +
        "\"attemptId\":\"" + escape(e.attemptId()) + "\"," +
        "\"packageName\":\"" + escape(e.packageName()) + "\"," +
        "\"previousVersionCode\":" + e.previousVersionCode() + "," +
        "\"newVersionCode\":" + e.newVersionCode() + "," +
        "\"projectFileCount\":" + e.projectFileCount() + "," +
        "\"signerCertificateSha256\":\"" + e.signerCertificateSha256() + "\"," +
        "\"existingApkSha256\":\"" + e.existingApkSha256() + "\"," +
        "\"outputApkSha256\":\"" + e.outputApkSha256() + "\"," +
        "\"completedAt\":\"" + e.completedAt() + "\"}";
  }

  private static String escape(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"");
  }
}
