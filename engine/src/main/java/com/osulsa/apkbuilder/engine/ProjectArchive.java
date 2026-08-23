package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public final class ProjectArchive {
  private ProjectArchive() {}

  private static final int MAX_ENTRIES = 5_000;
  private static final long MAX_SINGLE_FILE_BYTES = 50L * 1024L * 1024L;
  private static final long MAX_TOTAL_BYTES = 100L * 1024L * 1024L;
  private static final int BUFFER_SIZE = 32 * 1024;

  public record PreparedProject(Path projectRoot, String entryFile, List<String> files) {
    public PreparedProject {
      projectRoot = projectRoot.toAbsolutePath().normalize();
      files = List.copyOf(files);
    }
  }

  public static PreparedProject prepare(Path archive, Path extractionDir) throws TemplateException {
    if (archive == null || !Files.isRegularFile(archive)) {
      throw new TemplateException(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, "Project archive is missing");
    }
    if (extractionDir == null) {
      throw new TemplateException(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, "Project extraction directory is missing");
    }

    Path finalRoot = extractionDir.toAbsolutePath().normalize();
    Path parent = finalRoot.getParent();
    if (parent == null) {
      throw new TemplateException(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, "Project extraction directory has no parent");
    }
    Path tempRoot = parent.resolve("." + finalRoot.getFileName() + ".import-" + UUID.randomUUID()).normalize();

    try {
      Files.createDirectories(parent);
      Files.createDirectories(tempRoot);
      List<Path> extracted = extract(archive, tempRoot);
      ProjectSelection selection = selectProject(extracted);
      List<String> projectFiles = projectFiles(extracted, selection.projectRelativeRoot());

      deleteTree(finalRoot);
      try {
        Files.move(tempRoot, finalRoot, StandardCopyOption.ATOMIC_MOVE);
      } catch (AtomicMoveNotSupportedException e) {
        Files.move(tempRoot, finalRoot);
      }

      Path projectRoot = finalRoot.resolve(selection.projectRelativeRoot()).normalize();
      return new PreparedProject(projectRoot, selection.entryFile(), projectFiles);
    } catch (TemplateException e) {
      deleteTreeQuietly(tempRoot);
      throw e;
    } catch (ZipException e) {
      deleteTreeQuietly(tempRoot);
      throw new TemplateException(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, "Project ZIP is corrupt", e);
    } catch (IOException | RuntimeException e) {
      deleteTreeQuietly(tempRoot);
      throw new TemplateException(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, "Could not prepare project ZIP", e);
    }
  }

  private static List<Path> extract(Path archive, Path tempRoot) throws IOException, TemplateException {
    List<Path> extracted = new ArrayList<>();
    Set<String> seen = new HashSet<>();
    long totalBytes = 0;
    int fileCount = 0;

    try (ZipFile zip = new ZipFile(archive.toFile())) {
      Enumeration<? extends ZipEntry> entries = zip.entries();
      while (entries.hasMoreElements()) {
        ZipEntry entry = entries.nextElement();
        if (entry.isDirectory()) continue;

        String rawName = entry.getName();
        if (isNoise(rawName)) continue;
        Path relative = safeRelative(rawName);
        String key = slash(relative);
        if (!seen.add(key)) {
          throw invalid("Project ZIP contains duplicate path: " + key);
        }
        fileCount++;
        if (fileCount > MAX_ENTRIES) {
          throw invalid("Project ZIP contains too many files");
        }
        long declaredSize = entry.getSize();
        if (declaredSize > MAX_SINGLE_FILE_BYTES) {
          throw invalid("Project file is too large: " + key);
        }
        if (declaredSize > 0 && totalBytes + declaredSize > MAX_TOTAL_BYTES) {
          throw invalid("Project ZIP expands beyond the allowed size");
        }

        Path destination = tempRoot.resolve(relative).normalize();
        if (!destination.startsWith(tempRoot)) {
          throw invalid("Project ZIP path escapes staging: " + rawName);
        }
        Path destParent = destination.getParent();
        if (destParent != null) Files.createDirectories(destParent);

        long fileBytes = 0;
        try (InputStream in = zip.getInputStream(entry); OutputStream out = Files.newOutputStream(destination, StandardOpenOption.CREATE_NEW)) {
          byte[] buffer = new byte[BUFFER_SIZE];
          int read;
          while ((read = in.read(buffer)) != -1) {
            fileBytes += read;
            totalBytes += read;
            if (fileBytes > MAX_SINGLE_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) {
              throw invalid("Project ZIP expands beyond the allowed size");
            }
            out.write(buffer, 0, read);
          }
        }
        extracted.add(relative);
      }
    }

    if (extracted.isEmpty()) {
      throw invalid("Project ZIP contains no usable files");
    }
    return extracted;
  }

  private static Path safeRelative(String rawName) throws TemplateException {
    if (rawName == null || rawName.isBlank() || rawName.indexOf('\0') >= 0) {
      throw invalid("Project ZIP contains an invalid path");
    }
    String normalizedName = rawName.replace('\\', '/');
    if (normalizedName.startsWith("/") || normalizedName.matches("^[A-Za-z]:/.*")) {
      throw invalid("Project ZIP contains an absolute path: " + rawName);
    }
    String[] segments = normalizedName.split("/");
    for (String segment : segments) {
      if (segment.equals("..")) throw invalid("Project ZIP contains parent traversal: " + rawName);
    }
    Path relative;
    try {
      relative = Paths.get(normalizedName).normalize();
    } catch (InvalidPathException e) {
      throw new TemplateException(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, "Project ZIP contains an invalid path", e);
    }
    if (relative.isAbsolute() || relative.getNameCount() == 0 || relative.startsWith("..")) {
      throw invalid("Project ZIP contains an unsafe path: " + rawName);
    }
    return relative;
  }

  private static boolean isNoise(String rawName) {
    if (rawName == null) return false;
    String name = rawName.replace('\\', '/');
    return name.equals(".DS_Store") || name.endsWith("/.DS_Store") || name.startsWith("__MACOSX/");
  }

  private static ProjectSelection selectProject(List<Path> files) throws TemplateException {
    List<Path> rootIndexes = files.stream()
        .filter(ProjectArchive::isIndex)
        .filter(path -> path.getNameCount() == 1)
        .toList();
    if (rootIndexes.size() == 1) {
      return new ProjectSelection(Paths.get(""), rootIndexes.get(0).getFileName().toString());
    }
    if (rootIndexes.size() > 1) {
      throw noEntry("Project ZIP has multiple root index.html files");
    }

    List<Path> indexes = files.stream().filter(ProjectArchive::isIndex).toList();
    if (indexes.isEmpty()) {
      throw noEntry("Project ZIP has no index.html entry point");
    }
    if (indexes.size() > 1) {
      throw noEntry("Project ZIP has multiple possible index.html entry points");
    }
    Path index = indexes.get(0);
    Path projectRelativeRoot = index.getParent();
    if (projectRelativeRoot == null) projectRelativeRoot = Paths.get("");
    return new ProjectSelection(projectRelativeRoot, index.getFileName().toString());
  }

  private static boolean isIndex(Path path) {
    Path name = path.getFileName();
    return name != null && name.toString().equalsIgnoreCase("index.html");
  }

  private static List<String> projectFiles(List<Path> files, Path projectRelativeRoot) {
    List<String> result = new ArrayList<>();
    for (Path file : files) {
      if (!projectRelativeRoot.toString().isEmpty() && !file.startsWith(projectRelativeRoot)) continue;
      Path relative = projectRelativeRoot.toString().isEmpty() ? file : projectRelativeRoot.relativize(file);
      if (relative.getNameCount() > 0) result.add(slash(relative));
    }
    Collections.sort(result);
    return List.copyOf(result);
  }

  private static String slash(Path path) {
    return path.toString().replace(File.separatorChar, '/');
  }

  private static TemplateException invalid(String message) {
    return new TemplateException(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, message);
  }

  private static TemplateException noEntry(String message) {
    return new TemplateException(TemplateErrorCode.IMPORT_NO_ENTRY_POINT, message);
  }

  private static void deleteTree(Path root) throws IOException {
    if (!Files.exists(root)) return;
    try (var walk = Files.walk(root)) {
      for (Path path : walk.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
    }
  }

  private static void deleteTreeQuietly(Path root) {
    try { deleteTree(root); } catch (IOException ignored) { }
  }

  private record ProjectSelection(Path projectRelativeRoot, String entryFile) {}
}
