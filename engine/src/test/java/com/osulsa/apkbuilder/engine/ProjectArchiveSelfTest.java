package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public final class ProjectArchiveSelfTest {
  public static void main(String[] args) throws Exception {
    Path root = Files.createTempDirectory("project-archive-test-");
    testRootProject(root);
    testWrappedProject(root);
    testMissingEntry(root);
    testAmbiguousEntry(root);
    testZipSlip(root);
    testWindowsAbsolute(root);
    testInvalidZip(root);
    System.out.println("PROJECT_ARCHIVE_SELF_TEST_PASS");
  }

  private static void testRootProject(Path root) throws Exception {
    Path zip = root.resolve("root.zip");
    makeZip(zip, Map.of(
        "index.html", "<link rel='stylesheet' href='css/app.css'>",
        "css/app.css", "body{font-family:sans-serif}",
        "js/app.js", "console.log('ok')",
        "img/logo.png", "PNGDATA"));
    ProjectArchive.PreparedProject p = ProjectArchive.prepare(zip, root.resolve("root-out"));
    require(p.entryFile().equals("index.html"), "root entry file");
    require(p.files().equals(List.of("css/app.css", "img/logo.png", "index.html", "js/app.js")), "root file list deterministic");
    require(Files.readString(p.projectRoot().resolve("css/app.css")).contains("font-family"), "nested css preserved");
  }

  private static void testWrappedProject(Path root) throws Exception {
    Path zip = root.resolve("wrapped.zip");
    makeZip(zip, Map.of(
        "site/index.html", "<script src='assets/app.js'></script>",
        "site/assets/app.js", "window.READY=true",
        "__MACOSX/site/._index.html", "noise",
        ".DS_Store", "noise"));
    ProjectArchive.PreparedProject p = ProjectArchive.prepare(zip, root.resolve("wrapped-out"));
    require(p.entryFile().equals("index.html"), "wrapped entry file normalized to project root");
    require(p.files().equals(List.of("assets/app.js", "index.html")), "wrapper and mac noise stripped");
    require(Files.readString(p.projectRoot().resolve("assets/app.js")).contains("READY"), "wrapped nested asset preserved");
  }

  private static void testMissingEntry(Path root) throws Exception {
    Path zip = root.resolve("missing.zip"); makeZip(zip, Map.of("home.html", "no index"));
    expect(TemplateErrorCode.IMPORT_NO_ENTRY_POINT, () -> ProjectArchive.prepare(zip, root.resolve("missing-out")));
  }

  private static void testAmbiguousEntry(Path root) throws Exception {
    Path zip = root.resolve("ambiguous.zip"); makeZip(zip, Map.of("a/index.html", "a", "b/index.html", "b"));
    expect(TemplateErrorCode.IMPORT_NO_ENTRY_POINT, () -> ProjectArchive.prepare(zip, root.resolve("ambiguous-out")));
  }

  private static void testZipSlip(Path root) throws Exception {
    Path zip = root.resolve("slip.zip"); makeZip(zip, Map.of("../escape.txt", "owned", "index.html", "ok"));
    Path out = root.resolve("slip-out");
    expect(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, () -> ProjectArchive.prepare(zip, out));
    require(!Files.exists(root.resolve("escape.txt")), "zip slip did not escape extraction root");
  }

  private static void testWindowsAbsolute(Path root) throws Exception {
    Path zip = root.resolve("windows-abs.zip"); makeZip(zip, Map.of("C:\\evil.txt", "owned", "index.html", "ok"));
    expect(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, () -> ProjectArchive.prepare(zip, root.resolve("windows-out")));
  }

  private static void testInvalidZip(Path root) throws Exception {
    Path zip = root.resolve("invalid.zip"); Files.writeString(zip, "not-a-zip");
    expect(TemplateErrorCode.IMPORT_INVALID_ARCHIVE, () -> ProjectArchive.prepare(zip, root.resolve("invalid-out")));
  }

  private static void makeZip(Path zip, Map<String,String> files) throws Exception {
    try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(zip))) {
      List<String> names = new ArrayList<>(files.keySet()); Collections.sort(names);
      for (String name : names) {
        ZipEntry e = new ZipEntry(name); out.putNextEntry(e); out.write(files.get(name).getBytes(StandardCharsets.UTF_8)); out.closeEntry();
      }
    }
  }
  private interface Throwing { void run() throws Exception; }
  private static void expect(TemplateErrorCode code, Throwing r) throws Exception {
    try { r.run(); throw new AssertionError("Expected " + code); }
    catch (TemplateException e) { require(e.code() == code, "expected " + code + " got " + e.code()); }
  }
  private static void require(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
}
