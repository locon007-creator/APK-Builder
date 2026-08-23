package com.osulsa.apkbuilder.engine;

import java.io.InputStream;
import java.nio.file.*;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.time.Instant;
import java.util.Arrays;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

public final class LocalHtmlBuildEngine {
  private LocalHtmlBuildEngine() {}

  public static BuildEvidence build(
      Path templateApk,
      String contractJson,
      String builderVersion,
      Path attemptsRoot,
      byte[] html,
      PrivateKey signingKey,
      X509Certificate signingCertificate,
      Path verifiedOutput) throws TemplateException {
    TemplateContract contract = TemplateContractParser.parse(contractJson);
    return build(templateApk, contractJson, builderVersion, attemptsRoot, html,
        new AppIdentity("Generated App", contract.packageSkeleton(), 1, "1.0.0"),
        signingKey, signingCertificate, verifiedOutput);
  }

  public static BuildEvidence build(
      Path templateApk,
      String contractJson,
      String builderVersion,
      Path attemptsRoot,
      byte[] html,
      AppIdentity identity,
      PrivateKey signingKey,
      X509Certificate signingCertificate,
      Path verifiedOutput) throws TemplateException {
    if (html == null || html.length == 0) throw new TemplateException(TemplateErrorCode.IMPORT_NO_ENTRY_POINT, "HTML input is empty");
    if (identity == null) throw new TemplateException(TemplateErrorCode.PATCH_MANIFEST_FAILED, "App identity is missing");
    try {
      TemplateContract contract = TemplateContractParser.parse(contractJson);
      VerifiedTemplate verified = TemplateVerifier.verify(templateApk, contract, builderVersion);
      String sourceBefore = verified.sha256();
      Path staged = ApkStager.createAttempt(verified, attemptsRoot);
      Path attempt = staged.getParent();
      Path contentApk = attempt.resolve("generated-content.apk");
      Path unsigned = attempt.resolve("generated-unsigned.apk");
      Path signed = attempt.resolve("generated-signed.apk");
      ApkHtmlInjector.injectSingleHtml(staged, contentApk, html, identity);
      ApkManifestPatcher.patchIdentity(contentApk, unsigned, contract.packageSkeleton(), identity);
      ZipAlignmentVerifier.verify(unsigned);
      ApkManifestPatcher.verifyIdentity(unsigned, identity);
      V1ApkSigner.sign(unsigned, signed, signingKey, signingCertificate, "CERT");
      ZipAlignmentVerifier.verify(signed);
      ApkV1Verifier.verify(signed);
      ApkManifestPatcher.verifyIdentity(signed, identity);
      verifyPayload(signed, html, contract, identity);
      String sourceAfter = Hashing.sha256(templateApk);
      if (!sourceBefore.equals(sourceAfter)) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Immutable bundled template changed during build");
      AtomicApkPublisher.publish(signed, verifiedOutput, candidate -> {
        ApkV1Verifier.verify(candidate);
        ZipAlignmentVerifier.verify(candidate);
        ApkManifestPatcher.verifyIdentity(candidate, identity);
        verifyPayload(candidate, html, contract, identity);
      });
      String outputHash = Hashing.sha256(verifiedOutput);
      String inputHash = Hashing.hex(Hashing.sha256(html));
      String certHash = Hashing.hex(Hashing.sha256(signingCertificate.getEncoded()));
      BuildEvidence evidence = new BuildEvidence(
          attempt.getFileName().toString(), builderVersion, contract.templateVersion(), sourceBefore,
          inputHash, outputHash, certHash, identity.packageName(), "PASS", "PASS", Instant.now());
      Files.writeString(attempt.resolve("build-evidence.json"), evidence.toJson());
      return evidence;
    } catch (TemplateException e) { throw e; }
    catch (Exception e) { throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Local HTML build failed", e); }
  }

  private static void verifyPayload(Path signed, byte[] expectedHtml, TemplateContract contract, AppIdentity identity) throws Exception {
    try (ZipFile zip = new ZipFile(signed.toFile())) {
      for (String required : contract.requiredEntries()) if (zip.getEntry(required) == null) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output missing " + required);
      ZipEntry html = zip.getEntry("assets/html/index.html");
      if (html == null) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output missing HTML entry point");
      byte[] actual; try (InputStream in = zip.getInputStream(html)) { actual = in.readAllBytes(); }
      if (!Arrays.equals(actual, expectedHtml)) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output HTML differs from input");
      ZipEntry config = zip.getEntry("assets/app_config.json");
      if (config == null) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output missing shell config");
      String configText; try (InputStream in = zip.getInputStream(config)) { configText = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8); }
      if (!configText.contains("\"packageName\":\"" + jsonEscape(identity.packageName()) + "\"") ||
          !configText.contains("\"appName\":\"" + jsonEscape(identity.appName()) + "\"") ||
          !configText.contains("\"versionCode\":" + identity.versionCode()) ||
          !configText.contains("\"versionName\":\"" + jsonEscape(identity.versionName()) + "\"")) {
        throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output shell config identity does not match manifest identity");
      }
    }
  }

  private static String jsonEscape(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"");
  }
}
