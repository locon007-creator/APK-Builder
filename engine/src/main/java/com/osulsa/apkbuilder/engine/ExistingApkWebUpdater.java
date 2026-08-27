package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

/** Prepares an unsigned update APK by replacing only packaged web content and versionCode. */
public final class ExistingApkWebUpdater {
  private ExistingApkWebUpdater() {}

  public record UpdateResult(String packageName, int previousVersionCode, int newVersionCode, int projectFileCount) {}

  public static UpdateResult prepareUnsigned(
      Path existingApk,
      Path projectRoot,
      List<String> projectFiles,
      String entryFile,
      Path unsignedOutput) throws TemplateException {
    if (existingApk == null || !Files.isRegularFile(existingApk)) {
      throw new TemplateException(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, "Existing APK is missing");
    }
    if (unsignedOutput == null) {
      throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Update output path is missing");
    }

    PreparedFiles prepared = prepareFiles(projectRoot, projectFiles, entryFile);
    Path output = unsignedOutput.toAbsolutePath().normalize();
    Path parent = output.getParent();
    if (parent == null) throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Update output has no parent directory");
    Path temporary = parent.resolve("." + output.getFileName() + ".update-" + UUID.randomUUID() + ".tmp");

    try {
      Files.createDirectories(parent);
      BinaryManifestVersionBumper.ManifestInfo before;
      byte[] updatedManifest;
      try (ZipFile zip = new ZipFile(existingApk.toFile())) {
        ZipEntry manifestEntry = zip.getEntry("AndroidManifest.xml");
        ZipEntry classesEntry = zip.getEntry("classes.dex");
        ZipEntry configEntry = zip.getEntry("assets/app_config.json");
        if (manifestEntry == null || manifestEntry.isDirectory() || classesEntry == null || classesEntry.isDirectory()) {
          throw new TemplateException(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, "Existing APK is missing Android runtime entries");
        }
        if (configEntry == null || configEntry.isDirectory()) {
          throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Existing APK is missing app_config.json");
        }
        byte[] manifest = read(zip, manifestEntry);
        before = BinaryManifestVersionBumper.inspect(manifest);
        updatedManifest = BinaryManifestVersionBumper.bumpVersionCode(manifest);
        verifyEntryPoint(read(zip, configEntry), prepared.entryFile);
        rewrite(zip, updatedManifest, prepared, temporary);
      }

      verifyOutput(temporary, prepared, before.packageName(), before.versionCode() + 1);
      try {
        Files.move(temporary, output, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
      } catch (AtomicMoveNotSupportedException e) {
        Files.move(temporary, output, StandardCopyOption.REPLACE_EXISTING);
      }
      return new UpdateResult(before.packageName(), before.versionCode(), before.versionCode() + 1, prepared.files.size());
    } catch (TemplateException e) {
      deleteQuietly(temporary);
      throw e;
    } catch (ZipException e) {
      deleteQuietly(temporary);
      throw new TemplateException(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, "Existing APK is corrupt", e);
    } catch (IOException | RuntimeException e) {
      deleteQuietly(temporary);
      throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Could not prepare existing APK update", e);
    }
  }

  private static PreparedFiles prepareFiles(Path projectRoot, List<String> projectFiles, String entryFile) throws TemplateException {
    if (projectRoot == null || !Files.isDirectory(projectRoot, LinkOption.NOFOLLOW_LINKS) || projectFiles == null || projectFiles.isEmpty()) {
      throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Updated web project is missing");
    }
    if (entryFile == null || entryFile.isBlank()) throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Updated web project entry file is missing");
    Path root = projectRoot.toAbsolutePath().normalize();
    LinkedHashMap<String, Path> files = new LinkedHashMap<>();
    for (String name : projectFiles) {
      String normalizedName = validateRelativeName(name);
      if (files.containsKey(normalizedName)) throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Updated web project contains duplicate path: " + normalizedName);
      Path relative = Paths.get(normalizedName.replace('/', File.separatorChar));
      Path source = root.resolve(relative).normalize();
      if (!source.startsWith(root) || !Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS)) {
        throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Updated web project file is missing: " + normalizedName);
      }
      rejectSymlinkPath(root, relative);
      files.put(normalizedName, source);
    }
    String normalizedEntry = validateRelativeName(entryFile);
    if (!files.containsKey(normalizedEntry)) throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Updated web project entry file is not included");
    return new PreparedFiles(root, normalizedEntry, files);
  }

  private static String validateRelativeName(String raw) throws TemplateException {
    if (raw == null || raw.isBlank() || raw.indexOf('\0') >= 0) throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Updated web project contains an invalid path");
    String name = raw.replace('\\', '/');
    if (name.startsWith("/") || name.matches("^[A-Za-z]:/.*")) throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Updated web project contains an absolute path: " + raw);
    for (String segment : name.split("/", -1)) {
      if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Updated web project contains an unsafe path: " + raw);
    }
    Path normalized;
    try { normalized = Paths.get(name).normalize(); }
    catch (InvalidPathException e) { throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Updated web project contains an invalid path", e); }
    if (normalized.isAbsolute() || normalized.startsWith("..")) throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Updated web project contains an unsafe path: " + raw);
    return normalized.toString().replace(File.separatorChar, '/');
  }

  private static void rejectSymlinkPath(Path root, Path relative) throws TemplateException {
    Path current = root;
    for (Path segment : relative) {
      current = current.resolve(segment);
      if (Files.isSymbolicLink(current)) throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Updated web project cannot contain symbolic links");
    }
  }

  private static void verifyEntryPoint(byte[] configBytes, String entryFile) throws TemplateException {
    String json = new String(configBytes, StandardCharsets.UTF_8);
    String compact = json.replaceAll("\\s+", "");
    String expected = "\"entryFile\":\"" + jsonEscape(entryFile) + "\"";
    if (!compact.contains(expected)) {
      throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Updated web project entry point differs from the existing APK");
    }
  }

  private static void rewrite(ZipFile existing, byte[] updatedManifest, PreparedFiles project, Path output) throws IOException, TemplateException {
    try (AlignedZip.CountingOutputStream count = new AlignedZip.CountingOutputStream(Files.newOutputStream(output, StandardOpenOption.CREATE_NEW));
         ZipOutputStream out = new ZipOutputStream(count)) {
      Enumeration<? extends ZipEntry> entries = existing.entries();
      while (entries.hasMoreElements()) {
        ZipEntry source = entries.nextElement();
        String name = source.getName();
        if (isSignatureEntry(name) || name.startsWith("assets/html/")) continue;
        if ("AndroidManifest.xml".equals(name)) {
          ZipEntry replacement = replacementEntry(source, updatedManifest, count.count());
          out.putNextEntry(replacement); out.write(updatedManifest); out.closeEntry();
          continue;
        }
        ZipEntry copy = AlignedZip.copyMetadata(source, count.count());
        out.putNextEntry(copy);
        if (!source.isDirectory()) try (InputStream in = existing.getInputStream(source)) { in.transferTo(out); }
        out.closeEntry();
      }
      for (Map.Entry<String, Path> file : project.files.entrySet()) {
        String name = "assets/html/" + file.getKey();
        ZipEntry entry = new ZipEntry(name);
        entry.setTime(AlignedZip.ZIP_TIME);
        entry.setMethod(ZipEntry.DEFLATED);
        out.putNextEntry(entry);
        Files.copy(file.getValue(), out);
        out.closeEntry();
      }
    }
  }

  private static ZipEntry replacementEntry(ZipEntry source, byte[] data, long bytesBeforeHeader) {
    ZipEntry out = new ZipEntry(source.getName());
    out.setTime(AlignedZip.ZIP_TIME);
    if (source.getMethod() == ZipEntry.STORED) {
      CRC32 crc = new CRC32(); crc.update(data);
      out.setMethod(ZipEntry.STORED);
      out.setSize(data.length); out.setCompressedSize(data.length); out.setCrc(crc.getValue());
      int alignment = source.getName().endsWith(".so") ? 16384 : 4;
      out.setExtra(AlignedZip.paddingExtra(bytesBeforeHeader, source.getName(), alignment));
    } else {
      out.setMethod(ZipEntry.DEFLATED);
    }
    return out;
  }

  private static void verifyOutput(Path apk, PreparedFiles project, String expectedPackage, int expectedVersion) throws IOException, TemplateException {
    try (ZipFile zip = new ZipFile(apk.toFile())) {
      ZipEntry manifest = zip.getEntry("AndroidManifest.xml");
      if (manifest == null) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Updated APK is missing AndroidManifest.xml");
      BinaryManifestVersionBumper.ManifestInfo info = BinaryManifestVersionBumper.inspect(read(zip, manifest));
      if (!expectedPackage.equals(info.packageName()) || info.versionCode() != expectedVersion) {
        throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Updated APK identity changed unexpectedly");
      }
      for (Map.Entry<String, Path> file : project.files.entrySet()) {
        ZipEntry entry = zip.getEntry("assets/html/" + file.getKey());
        if (entry == null || entry.isDirectory()) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Updated APK is missing project file: " + file.getKey());
        if (!Arrays.equals(Files.readAllBytes(file.getValue()), read(zip, entry))) {
          throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Updated APK project file differs from input: " + file.getKey());
        }
      }
      Enumeration<? extends ZipEntry> all = zip.entries();
      while (all.hasMoreElements()) {
        String name = all.nextElement().getName();
        if (isSignatureEntry(name)) throw new TemplateException(TemplateErrorCode.OUTPUT_VERIFY_FAILED, "Updated unsigned APK still contains an old signature");
      }
    }
  }

  private static boolean isSignatureEntry(String name) {
    if (name == null) return false;
    String upper = name.toUpperCase(Locale.ROOT);
    if (upper.equals("META-INF/MANIFEST.MF")) return true;
    if (!upper.startsWith("META-INF/")) return false;
    return upper.endsWith(".SF") || upper.endsWith(".RSA") || upper.endsWith(".DSA") || upper.endsWith(".EC");
  }

  private static byte[] read(ZipFile zip, ZipEntry entry) throws IOException {
    try (InputStream in = zip.getInputStream(entry)) { return in.readAllBytes(); }
  }

  private static String jsonEscape(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  private static void deleteQuietly(Path path) { try { Files.deleteIfExists(path); } catch (IOException ignored) { } }
  private record PreparedFiles(Path root, String entryFile, LinkedHashMap<String, Path> files) {}
}
