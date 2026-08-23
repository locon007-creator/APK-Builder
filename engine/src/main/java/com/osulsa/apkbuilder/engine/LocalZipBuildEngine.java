package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.file.*;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.time.Instant;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

public final class LocalZipBuildEngine {
  private LocalZipBuildEngine() {}

  public static BuildEvidence build(
      Path templateApk,
      String contractJson,
      String builderVersion,
      Path attemptsRoot,
      Path projectArchive,
      PrivateKey signingKey,
      X509Certificate signingCertificate,
      Path verifiedOutput) throws TemplateException {
    if (projectArchive == null || !Files.isRegularFile(projectArchive)) {
      throw new TemplateException(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, "Project ZIP is missing");
    }
    try {
      TemplateContract contract = TemplateContractParser.parse(contractJson);
      VerifiedTemplate verified = TemplateVerifier.verify(templateApk, contract, builderVersion);
      String sourceBefore = verified.sha256();
      Path staged = ApkStager.createAttempt(verified, attemptsRoot);
      Path attempt = staged.getParent();
      ProjectArchive.PreparedProject project = ProjectArchive.prepare(projectArchive, attempt.resolve("project"));
      Path unsigned = attempt.resolve("generated-unsigned.apk");
      Path signed = attempt.resolve("generated-signed.apk");

      ApkProjectInjector.injectProject(
          staged,
          unsigned,
          project.projectRoot(),
          project.entryFile(),
          contract.packageSkeleton());
      ZipAlignmentVerifier.verify(unsigned);
      V1ApkSigner.sign(unsigned, signed, signingKey, signingCertificate, "CERT");
      ZipAlignmentVerifier.verify(signed);
      ApkV1Verifier.verify(signed);
      verifyPayload(signed, project, contract);

      String sourceAfter = Hashing.sha256(templateApk);
      if (!sourceBefore.equals(sourceAfter)) {
        throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Immutable bundled template changed during ZIP build");
      }

      Path outputParent = verifiedOutput.toAbsolutePath().getParent();
      if (outputParent != null) Files.createDirectories(outputParent);
      Files.copy(signed, verifiedOutput, StandardCopyOption.REPLACE_EXISTING);
      ApkV1Verifier.verify(verifiedOutput);
      ZipAlignmentVerifier.verify(verifiedOutput);
      verifyPayload(verifiedOutput, project, contract);

      String outputHash = Hashing.sha256(verifiedOutput);
      String inputHash = Hashing.sha256(projectArchive);
      String certHash = Hashing.hex(Hashing.sha256(signingCertificate.getEncoded()));
      BuildEvidence evidence = new BuildEvidence(
          attempt.getFileName().toString(),
          builderVersion,
          contract.templateVersion(),
          sourceBefore,
          inputHash,
          outputHash,
          certHash,
          contract.packageSkeleton(),
          "PASS",
          "PASS",
          Instant.now());
      Files.writeString(attempt.resolve("build-evidence.json"), evidence.toJson());
      return evidence;
    } catch (TemplateException e) {
      throw e;
    } catch (Exception e) {
      throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Local ZIP build failed", e);
    }
  }

  private static void verifyPayload(
      Path signed,
      ProjectArchive.PreparedProject project,
      TemplateContract contract) throws Exception {
    try (ZipFile zip = new ZipFile(signed.toFile())) {
      for (String required : contract.requiredEntries()) {
        if (zip.getEntry(required) == null) {
          throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output missing " + required);
        }
      }

      Set<String> expectedAssets = new TreeSet<>();
      for (String relativeName : project.files()) {
        Path source = project.projectRoot().resolve(relativeName).normalize();
        if (!source.startsWith(project.projectRoot()) || !Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS)) {
          throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Prepared project file is missing: " + relativeName);
        }
        String zipName = "assets/html/" + relativeName.replace('\\', '/');
        expectedAssets.add(zipName);
        ZipEntry entry = zip.getEntry(zipName);
        if (entry == null || entry.isDirectory()) {
          throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output missing project file: " + relativeName);
        }
        byte[] expected = Files.readAllBytes(source);
        byte[] actual;
        try (InputStream in = zip.getInputStream(entry)) { actual = in.readAllBytes(); }
        if (!Arrays.equals(expected, actual)) {
          throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output project file differs from input: " + relativeName);
        }
      }

      Set<String> actualAssets = new TreeSet<>();
      Enumeration<? extends ZipEntry> entries = zip.entries();
      while (entries.hasMoreElements()) {
        ZipEntry entry = entries.nextElement();
        if (!entry.isDirectory() && entry.getName().startsWith("assets/html/")) actualAssets.add(entry.getName());
      }
      if (!actualAssets.equals(expectedAssets)) {
        throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output HTML project file set does not match input");
      }

      ZipEntry configEntry = zip.getEntry("assets/app_config.json");
      if (configEntry == null || configEntry.isDirectory()) {
        throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output missing shell config");
      }
      String config;
      try (InputStream in = zip.getInputStream(configEntry)) {
        config = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
      }
      if (!config.contains("\"appType\":\"HTML\"") ||
          !config.contains("\"siteAssetBase\":\"html\"") ||
          !config.contains("\"entryFile\":\"" + jsonEscape(project.entryFile()) + "\"") ||
          !config.contains("\"enableNativeBridge\":false")) {
        throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Output shell config does not match safe HTML project runtime");
      }
    }
  }

  private static String jsonEscape(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"");
  }
}
