package com.osulsa.apkbuilder.engine;

import java.io.IOException;
import java.nio.file.*;
import java.util.UUID;

public final class AtomicApkPublisher {
  private AtomicApkPublisher() {}

  @FunctionalInterface
  public interface Verifier {
    void verify(Path candidate) throws Exception;
  }

  public static void publish(Path source, Path finalOutput, Verifier verifier) throws TemplateException {
    if (source == null || !Files.isRegularFile(source)) {
      throw failed("Verified source APK is missing", null);
    }
    if (finalOutput == null) {
      throw failed("Final output path is missing", null);
    }
    if (verifier == null) {
      throw failed("Output verifier is missing", null);
    }

    Path finalPath = finalOutput.toAbsolutePath().normalize();
    Path parent = finalPath.getParent();
    if (parent == null) {
      throw failed("Final output path has no parent", null);
    }
    Path temp = parent.resolve("." + finalPath.getFileName() + ".publishing-" + UUID.randomUUID()).normalize();

    try {
      Files.createDirectories(parent);
      Files.copy(source, temp, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);
      verifier.verify(temp);
      try {
        Files.move(temp, finalPath, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
      } catch (AtomicMoveNotSupportedException e) {
        Files.move(temp, finalPath, StandardCopyOption.REPLACE_EXISTING);
      }
    } catch (TemplateException e) {
      deleteQuietly(temp);
      throw e;
    } catch (Exception e) {
      deleteQuietly(temp);
      throw failed("Could not atomically publish verified APK", e);
    } finally {
      deleteQuietly(temp);
    }
  }

  private static TemplateException failed(String message, Throwable cause) {
    return cause == null
        ? new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, message)
        : new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, message, cause);
  }

  private static void deleteQuietly(Path path) {
    if (path == null) return;
    try { Files.deleteIfExists(path); } catch (IOException ignored) { }
  }
}
