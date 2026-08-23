package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.*;
import java.util.zip.*;

public final class LocalZipBuildEngineSelfTest {
  public static void main(String[] args) throws Exception {
    Path root = Files.createTempDirectory("local-zip-build-");
    testFullZipBuild(root);
    testBadArchiveDoesNotPublish(root);
    System.out.println("LOCAL_ZIP_BUILD_ENGINE_SELF_TEST_PASS");
  }

  private static void testFullZipBuild(Path root) throws Exception {
    Path template = makeShell(root.resolve("zip-template.apk"));
    Path archive = root.resolve("project.zip");
    makeProjectZip(archive);
    SigningMaterial signing = signingMaterial(root.resolve("zip-key.p12"));
    Path output = root.resolve("zip-output.apk");

    BuildEvidence evidence = LocalZipBuildEngine.build(
        template,
        contractJson(Hashing.sha256(template)),
        "1.0.0",
        root.resolve("zip-attempts"),
        archive,
        signing.key(),
        signing.cert(),
        output);

    require(Files.isRegularFile(output) && Files.size(output) > 0, "ZIP build output exists");
    require(evidence.inputSha256().equals(Hashing.sha256(archive)), "ZIP evidence input hash matches archive");
    require(evidence.outputSha256().equals(Hashing.sha256(output)), "ZIP evidence output hash matches");
    require("PASS".equals(evidence.alignmentResult()), "ZIP alignment evidence pass");
    require("PASS".equals(evidence.signatureVerificationResult()), "ZIP signature evidence pass");
    ApkV1Verifier.verify(output);
    ZipAlignmentVerifier.verify(output);

    try (ZipFile zip = new ZipFile(output.toFile())) {
      require(text(zip, "assets/html/index.html").contains("css/app.css"), "HTML entry packaged");
      require(text(zip, "assets/html/css/app.css").contains("font-family"), "CSS packaged");
      require(text(zip, "assets/html/js/app.js").contains("ZIP_READY"), "JS packaged");
      require(text(zip, "assets/app_config.json").contains("\"enableNativeBridge\":false"), "bridge remains disabled");
      require(zip.getEntry("META-INF/OLD.RSA") == null, "old signature removed");
    }
  }

  private static void testBadArchiveDoesNotPublish(Path root) throws Exception {
    Path template = makeShell(root.resolve("bad-zip-template.apk"));
    Path archive = root.resolve("bad-project.zip");
    try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(archive))) {
      put(out, "home.html", "no index");
    }
    SigningMaterial signing = signingMaterial(root.resolve("bad-zip-key.p12"));
    Path output = root.resolve("bad-zip-output.apk");
    expectCode(TemplateErrorCode.IMPORT_NO_ENTRY_POINT, () -> LocalZipBuildEngine.build(
        template, contractJson(Hashing.sha256(template)), "1.0.0", root.resolve("bad-zip-attempts"), archive,
        signing.key(), signing.cert(), output));
    require(!Files.exists(output), "invalid ZIP did not publish output APK");
  }

  private static String text(ZipFile zip, String name) throws Exception {
    ZipEntry entry = zip.getEntry(name);
    require(entry != null, "missing ZIP entry " + name);
    try (InputStream in = zip.getInputStream(entry)) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
  }

  private record SigningMaterial(PrivateKey key, X509Certificate cert) {}

  private static SigningMaterial signingMaterial(Path ks) throws Exception {
    Process p = new ProcessBuilder("keytool", "-genkeypair", "-storetype", "PKCS12", "-keystore", ks.toString(),
        "-storepass", "android", "-keypass", "android", "-alias", "test", "-keyalg", "RSA", "-keysize", "2048",
        "-validity", "3650", "-dname", "CN=APK Builder ZIP Test,O=OSULSA,C=US", "-noprompt")
        .redirectErrorStream(true).start();
    String output = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    require(p.waitFor() == 0, "keytool failed: " + output);
    KeyStore store = KeyStore.getInstance("PKCS12");
    try (InputStream in = Files.newInputStream(ks)) { store.load(in, "android".toCharArray()); }
    return new SigningMaterial(
        (PrivateKey) store.getKey("test", "android".toCharArray()),
        (X509Certificate) store.getCertificate("test"));
  }

  private static Path makeShell(Path apk) throws Exception {
    try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(apk))) {
      put(out, "AndroidManifest.xml", "manifest");
      put(out, "resources.arsc", "resources");
      put(out, "classes.dex", "dex");
      put(out, "assets/html/old.js", "old");
      put(out, "assets/app_config.json", "{\"appType\":\"WEB\"}");
      put(out, "META-INF/OLD.RSA", "old-signature");
    }
    return apk;
  }

  private static void makeProjectZip(Path zip) throws Exception {
    try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(zip))) {
      put(out, "site/index.html", "<!doctype html><link rel='stylesheet' href='css/app.css'><script src='js/app.js'></script>");
      put(out, "site/css/app.css", "body{font-family:sans-serif}");
      put(out, "site/js/app.js", "window.ZIP_READY=true;");
      put(out, "site/img/logo.txt", "logo");
    }
  }

  private static void put(ZipOutputStream out, String name, String value) throws Exception {
    ZipEntry entry = new ZipEntry(name);
    out.putNextEntry(entry);
    out.write(value.getBytes(StandardCharsets.UTF_8));
    out.closeEntry();
  }

  private static String contractJson(String sha) {
    return "{" +
        "\"contractVersion\":1," +
        "\"templateVersion\":\"1.0.0\"," +
        "\"templateFile\":\"template/webview_shell.apk\"," +
        "\"sha256\":\"" + sha + "\"," +
        "\"minimumBuilderVersion\":\"1.0.0\"," +
        "\"packageSkeleton\":\"com.osulsa.generated\"," +
        "\"requiredEntries\":[\"AndroidManifest.xml\",\"resources.arsc\",\"classes.dex\"]," +
        "\"capabilities\":[]}";
  }

  private interface Throwing { void run() throws Exception; }
  private static void expectCode(TemplateErrorCode code, Throwing r) throws Exception {
    try { r.run(); throw new AssertionError("Expected " + code); }
    catch (TemplateException e) { require(e.code() == code, "expected " + code + " got " + e.code()); }
  }
  private static void require(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
}
