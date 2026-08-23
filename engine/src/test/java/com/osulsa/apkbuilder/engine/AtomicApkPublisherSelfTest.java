package com.osulsa.apkbuilder.engine;

import java.nio.file.*;

public final class AtomicApkPublisherSelfTest {
  public static void main(String[] args) throws Exception {
    Path root = Files.createTempDirectory("atomic-apk-publish-");
    testSuccessfulPublish(root);
    testFailedVerificationPreservesExistingOutput(root);
    testMissingSourcePreservesExistingOutput(root);
    System.out.println("ATOMIC_APK_PUBLISHER_SELF_TEST_PASS");
  }

  private static void testSuccessfulPublish(Path root) throws Exception {
    Path source = root.resolve("good-source.apk");
    Path output = root.resolve("nested/final.apk");
    Files.writeString(source, "verified-payload");
    AtomicApkPublisher.publish(source, output, path -> {
      require(Files.readString(path).equals("verified-payload"), "verifier saw copied source bytes");
    });
    require(Files.readString(output).equals("verified-payload"), "final output published");
    require(noPublishingTemps(output.getParent()), "no temporary publish file remains");
  }

  private static void testFailedVerificationPreservesExistingOutput(Path root) throws Exception {
    Path source = root.resolve("bad-source.apk");
    Path output = root.resolve("preserve/final.apk");
    Files.createDirectories(output.getParent());
    Files.writeString(source, "new-but-invalid");
    Files.writeString(output, "known-good-existing");
    try {
      AtomicApkPublisher.publish(source, output, path -> { throw new IllegalStateException("verification failed"); });
      throw new AssertionError("Expected publish verification failure");
    } catch (TemplateException e) {
      require(e.code() == TemplateErrorCode.OUTPUT_VERIFY_FAILED, "publish failure has deterministic code");
    }
    require(Files.readString(output).equals("known-good-existing"), "existing final output preserved on verification failure");
    require(noPublishingTemps(output.getParent()), "failed publish cleaned temporary file");
  }

  private static void testMissingSourcePreservesExistingOutput(Path root) throws Exception {
    Path source = root.resolve("missing.apk");
    Path output = root.resolve("missing-case/final.apk");
    Files.createDirectories(output.getParent());
    Files.writeString(output, "still-good");
    try {
      AtomicApkPublisher.publish(source, output, path -> {});
      throw new AssertionError("Expected missing source failure");
    } catch (TemplateException e) {
      require(e.code() == TemplateErrorCode.OUTPUT_VERIFY_FAILED, "missing source has output verification code");
    }
    require(Files.readString(output).equals("still-good"), "missing source does not destroy existing final output");
  }

  private static boolean noPublishingTemps(Path dir) throws Exception {
    if (dir == null || !Files.exists(dir)) return true;
    try (var files = Files.list(dir)) {
      return files.noneMatch(path -> path.getFileName().toString().contains(".publishing-"));
    }
  }

  private static void require(boolean ok, String message) {
    if (!ok) throw new AssertionError(message);
  }
}
