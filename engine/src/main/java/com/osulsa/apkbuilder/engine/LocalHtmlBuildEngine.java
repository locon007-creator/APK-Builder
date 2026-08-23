package com.osulsa.apkbuilder.engine;

import java.io.InputStream;
import java.nio.file.*;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.time.Instant;
import java.util.Arrays;
import java.util.UUID;
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
    if (html == null || html.length == 0) throw new TemplateException(TemplateErrorCode.IMPORT_NO_ENTRY_POINT, "HTML input is empty");
    try {
      TemplateContract contract = TemplateContractParser.parse(contractJson);
      VerifiedTemplate verified = TemplateVerifier.verify(templateApk, contract, builderVersion);
      String sourceBefore = verified.sha256();
      Path staged = ApkStager.createAttempt(verified, attemptsRoot);
      Path attempt = staged.getParent();
      Path unsigned = attempt.resolve("generated-unsigned.apk");
      Path signed = attempt.resolve("generated-signed.apk");
      ApkHtmlInjector.injectSingleHtml(staged, unsigned, html);
      ZipAlignmentVerifier.verify(unsigned);
      V1ApkSigner.sign(unsigned, signed, signingKey, signingCertificate, "CERT");
      ZipAlignmentVerifier.verify(signed);
      ApkV1Verifier.verify(signed);
      verifyPayload(signed, html, contract);
      String sourceAfter = Hashing.sha256(templateApk);
      if (!sourceBefore.equals(sourceAfter)) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Immutable bundled template changed during build");
      Files.createDirectories(verifiedOutput.toAbsolutePath().getParent());
      Files.copy(signed, verifiedOutput, StandardCopyOption.REPLACE_EXISTING);
      ApkV1Verifier.verify(verifiedOutput);
      ZipAlignmentVerifier.verify(verifiedOutput);
      String outputHash = Hashing.sha256(verifiedOutput);
      String inputHash = Hashing.hex(Hashing.sha256(html));
      String certHash = Hashing.hex(Hashing.sha256(signingCertificate.getEncoded()));
      BuildEvidence evidence = new BuildEvidence(
          attempt.getFileName().toString(), builderVersion, contract.templateVersion(), sourceBefore,
          inputHash, outputHash, certHash, contract.packageSkeleton(), "PASS", "PASS", Instant.now());
      Files.writeString(attempt.resolve("build-evidence.json"), evidence.toJson());
      return evidence;
    } catch (TemplateException e) { throw e; }
    catch (Exception e) { throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Local HTML build failed", e); }
  }

  private static void verifyPayload(Path signed, byte[] expectedHtml, TemplateContract contract) throws Exception {
    try (ZipFile zip = new ZipFile(signed.toFile())) {
      for (String required : contract.requiredEntries()) if (zip.getEntry(required) == null) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output missing " + required);
      ZipEntry html = zip.getEntry("assets/www/index.html");
      if (html == null) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output missing HTML entry point");
      byte[] actual; try (InputStream in = zip.getInputStream(html)) { actual = in.readAllBytes(); }
      if (!Arrays.equals(actual, expectedHtml)) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output HTML differs from input");
    }
  }
}
