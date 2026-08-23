package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public final class ApkProjectInjector {
  private ApkProjectInjector() {}
  private static final String HTML_PREFIX = "assets/html/";
  private static final String CONFIG_ENTRY = "assets/app_config.json";

  public static void injectProject(
      Path stagedApk,
      Path outputApk,
      Path projectRoot,
      String entryFile,
      String packageName) throws TemplateException {
    injectProject(stagedApk, outputApk, projectRoot, entryFile,
        new AppIdentity("Generated App", packageName, 1, "1.0.0"));
  }

  public static void injectProject(
      Path stagedApk,
      Path outputApk,
      Path projectRoot,
      String entryFile,
      AppIdentity identity) throws TemplateException {
    if (projectRoot == null || !Files.isDirectory(projectRoot)) {
      throw patch("Project directory is missing");
    }
    Path root = projectRoot.toAbsolutePath().normalize();
    Path entry = root.resolve(entryFile == null ? "" : entryFile).normalize();
    if (!entry.startsWith(root) || !Files.isRegularFile(entry) || Files.isSymbolicLink(entry)) {
      throw patch("Project entry file is missing or unsafe: " + entryFile);
    }

    List<Path> files = collectFiles(root);
    try (ZipFile input = new ZipFile(stagedApk.toFile());
         AlignedZip.CountingOutputStream count = new AlignedZip.CountingOutputStream(Files.newOutputStream(outputApk));
         ZipOutputStream out = new ZipOutputStream(count)) {
      Enumeration<? extends ZipEntry> entries = input.entries();
      while (entries.hasMoreElements()) {
        ZipEntry in = entries.nextElement();
        String name = in.getName();
        if (name.startsWith(HTML_PREFIX) || name.equals(CONFIG_ENTRY) || ApkHtmlInjector.isSignatureEntry(name)) continue;
        ZipEntry copy = AlignedZip.copyMetadata(in, count.count());
        out.putNextEntry(copy);
        if (!in.isDirectory()) {
          try (InputStream stream = input.getInputStream(in)) { stream.transferTo(out); }
        }
        out.closeEntry();
      }

      for (Path file : files) {
        Path relative = root.relativize(file);
        String relativeName = relative.toString().replace(File.separatorChar, '/');
        ZipEntry asset = new ZipEntry(HTML_PREFIX + relativeName);
        asset.setTime(AlignedZip.ZIP_TIME);
        asset.setMethod(ZipEntry.DEFLATED);
        out.putNextEntry(asset);
        Files.copy(file, out);
        out.closeEntry();
      }

      ZipEntry config = new ZipEntry(CONFIG_ENTRY);
      config.setTime(AlignedZip.ZIP_TIME);
      config.setMethod(ZipEntry.DEFLATED);
      out.putNextEntry(config);
      out.write(ShellConfigFactory.singleHtml(identity, entryFile));
      out.closeEntry();
    } catch (Exception e) {
      throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Could not inject project into staged APK", e);
    }
  }

  private static List<Path> collectFiles(Path root) throws TemplateException {
    try (var walk = Files.walk(root)) {
      List<Path> files = new ArrayList<>();
      for (Path path : walk.toList()) {
        if (path.equals(root)) continue;
        if (Files.isSymbolicLink(path)) throw patch("Project contains a symbolic link: " + root.relativize(path));
        if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) continue;
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) throw patch("Project contains an unsupported file: " + root.relativize(path));
        Path normalized = path.toAbsolutePath().normalize();
        if (!normalized.startsWith(root)) throw patch("Project file escapes project root: " + path);
        files.add(normalized);
      }
      files.sort(Comparator.comparing(path -> root.relativize(path).toString().replace(File.separatorChar, '/')));
      return List.copyOf(files);
    } catch (TemplateException e) {
      throw e;
    } catch (IOException e) {
      throw new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, "Could not enumerate project files", e);
    }
  }

  private static TemplateException patch(String message) {
    return new TemplateException(TemplateErrorCode.PATCH_ASSETS_FAILED, message);
  }
}
