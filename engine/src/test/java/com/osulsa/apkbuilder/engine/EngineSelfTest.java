package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.*;
import java.util.zip.*;

public final class EngineSelfTest {
  public static void main(String[] args) throws Exception {
    Path root = Files.createTempDirectory("apk-engine-test-");
    testValidTemplate(root);
    testContractValidation();
    testBadChecksum(root);
    testMissingEntry(root);
    testIncompatibleVersion(root);
    testCorruptZip(root);
    testImmutableStagingAndHtmlInjection(root);
    testAlignment(root);
    testV1Signing(root);
    testFullLocalHtmlBuild(root);
    System.out.println("ENGINE_SELF_TEST_PASS");
  }

  private static void testContractValidation() throws Exception {
    String valid = contractJson("0".repeat(64));
    TemplateContractParser.parse(valid);
    expectCode(TemplateErrorCode.TEMPLATE_CONTRACT_INVALID, () -> TemplateContractParser.parse(valid.replace("\"packageSkeleton\":\"com.osulsa.generated\",", "")));
    expectCode(TemplateErrorCode.TEMPLATE_CONTRACT_INVALID, () -> TemplateContractParser.parse(valid.replace("\"capabilities\":[]", "\"capabilities\":[\"root_access\"]")));
    expectCode(TemplateErrorCode.TEMPLATE_CONTRACT_INVALID, () -> TemplateContractParser.parse(valid.substring(0, valid.length()-1) + ",\"unexpected\":true}"));
  }

  private static void testValidTemplate(Path root) throws Exception {
    Path apk = makeShell(root.resolve("valid.apk"), true);
    String sha = Hashing.sha256(apk);
    String json = contractJson(sha);
    TemplateContract contract = TemplateContractParser.parse(json);
    VerifiedTemplate verified = TemplateVerifier.verify(apk, contract, "1.0.0");
    require(verified.sha256().equals(sha), "valid template hash");
  }

  private static void testBadChecksum(Path root) throws Exception {
    Path apk = makeShell(root.resolve("bad-hash.apk"), true);
    TemplateContract contract = TemplateContractParser.parse(contractJson("0".repeat(64)));
    expectCode(TemplateErrorCode.TEMPLATE_CHECKSUM_MISMATCH, () -> TemplateVerifier.verify(apk, contract, "1.0.0"));
  }

  private static void testMissingEntry(Path root) throws Exception {
    Path apk = makeShell(root.resolve("missing-entry.apk"), false);
    TemplateContract contract = TemplateContractParser.parse(contractJson(Hashing.sha256(apk)));
    expectCode(TemplateErrorCode.TEMPLATE_CORRUPT, () -> TemplateVerifier.verify(apk, contract, "1.0.0"));
  }

  private static void testIncompatibleVersion(Path root) throws Exception {
    Path apk = makeShell(root.resolve("incompatible.apk"), true);
    TemplateContract contract = TemplateContractParser.parse(contractJson(Hashing.sha256(apk)).replace("\"minimumBuilderVersion\":\"1.0.0\"", "\"minimumBuilderVersion\":\"2.0.0\""));
    expectCode(TemplateErrorCode.TEMPLATE_INCOMPATIBLE, () -> TemplateVerifier.verify(apk, contract, "1.0.0"));
  }

  private static void testCorruptZip(Path root) throws Exception {
    Path apk = root.resolve("corrupt.apk"); Files.writeString(apk, "not a zip");
    TemplateContract contract = TemplateContractParser.parse(contractJson(Hashing.sha256(apk)));
    expectCode(TemplateErrorCode.TEMPLATE_CORRUPT, () -> TemplateVerifier.verify(apk, contract, "1.0.0"));
  }

  private static void testImmutableStagingAndHtmlInjection(Path root) throws Exception {
    Path apk = makeShell(root.resolve("stage.apk"), true);
    byte[] original = Files.readAllBytes(apk);
    TemplateContract contract = TemplateContractParser.parse(contractJson(Hashing.sha256(apk)));
    VerifiedTemplate verified = TemplateVerifier.verify(apk, contract, "1.0.0");
    Path attemptRoot = root.resolve("attempts");
    Path staged = ApkStager.createAttempt(verified, attemptRoot);
    require(!staged.equals(apk), "staged path differs");
    Path out = staged.getParent().resolve("generated-unsigned.apk");
    String html = "<!doctype html><title>APK Builder Test</title><h1>works</h1>";
    ApkHtmlInjector.injectSingleHtml(staged, out, html.getBytes(StandardCharsets.UTF_8));
    ZipAlignmentVerifier.verify(out);
    require(Arrays.equals(original, Files.readAllBytes(apk)), "immutable template unchanged");
    try (ZipFile z = new ZipFile(out.toFile())) {
      require(z.getEntry("assets/www/index.html") != null, "html entry exists");
      String got = new String(z.getInputStream(z.getEntry("assets/www/index.html")).readAllBytes(), StandardCharsets.UTF_8);
      require(got.equals(html), "html content matches");
      require(z.getEntry("META-INF/OLD.RSA") == null, "old signatures stripped");
    }
  }

  private static void testAlignment(Path root) throws Exception {
    Path apk = root.resolve("stored.apk");
    try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(apk))) {
      put(out, "AndroidManifest.xml", "manifest".getBytes(StandardCharsets.UTF_8));
      putStored(out, "resources.arsc", "stored-resource".getBytes(StandardCharsets.UTF_8));
      put(out, "classes.dex", "dex".getBytes(StandardCharsets.UTF_8));
    }
    TemplateContract contract = TemplateContractParser.parse(contractJson(Hashing.sha256(apk)));
    Path staged = ApkStager.createAttempt(TemplateVerifier.verify(apk, contract, "1.0.0"), root.resolve("align-attempts"));
    Path out = staged.getParent().resolve("aligned.apk");
    ApkHtmlInjector.injectSingleHtml(staged, out, "<h1>align</h1>".getBytes(StandardCharsets.UTF_8));
    try (ZipFile z = new ZipFile(out.toFile())) { require(z.getEntry("resources.arsc").getMethod() == ZipEntry.STORED, "stored method preserved"); }
    ZipAlignmentVerifier.verify(out);
  }

  private static void testV1Signing(Path root) throws Exception {
    Path unsigned = makeShell(root.resolve("unsigned.apk"), true);
    SigningMaterial signing = signingMaterial(root.resolve("test-key.p12"));
    Path signed = root.resolve("signed.apk");
    V1ApkSigner.sign(unsigned, signed, signing.key(), signing.cert(), "CERT");

    Process verify = new ProcessBuilder("jarsigner", "-verify", "-verbose", signed.toString()).redirectErrorStream(true).start();
    String verifyOut = new String(verify.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    require(verify.waitFor() == 0, "jarsigner verification failed: " + verifyOut);
    require(!verifyOut.toLowerCase(Locale.ROOT).contains("unsigned entries"), "payload entries were not signature-covered: " + verifyOut);
    ApkV1Verifier.verify(signed);
    ZipAlignmentVerifier.verify(signed);
  }

  private static void testFullLocalHtmlBuild(Path root) throws Exception {
    Path template = makeShell(root.resolve("full-template.apk"), true);
    SigningMaterial signing = signingMaterial(root.resolve("full-build-key.p12"));
    byte[] html = "<!doctype html><html><body><h1>FULL BUILD PASS</h1></body></html>".getBytes(StandardCharsets.UTF_8);
    Path output = root.resolve("verified-output.apk");
    BuildEvidence evidence = LocalHtmlBuildEngine.build(template, contractJson(Hashing.sha256(template)), "1.0.0", root.resolve("full-attempts"), html, signing.key(), signing.cert(), output);
    require(Files.size(output) > 0, "full build output exists");
    require(evidence.outputSha256().equals(Hashing.sha256(output)), "evidence output hash matches");
    require("PASS".equals(evidence.alignmentResult()), "evidence alignment pass");
    require("PASS".equals(evidence.signatureVerificationResult()), "evidence signature pass");
    ApkV1Verifier.verify(output);
    ZipAlignmentVerifier.verify(output);
  }

  private record SigningMaterial(PrivateKey key, X509Certificate cert) {}
  private static SigningMaterial signingMaterial(Path ks) throws Exception {
    Process p = new ProcessBuilder("keytool", "-genkeypair", "-storetype", "PKCS12", "-keystore", ks.toString(),
        "-storepass", "android", "-keypass", "android", "-alias", "test", "-keyalg", "RSA", "-keysize", "2048",
        "-validity", "3650", "-dname", "CN=APK Builder Test,O=OSULSA,C=US", "-noprompt").redirectErrorStream(true).start();
    String keytoolOut = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    require(p.waitFor() == 0, "keytool failed: " + keytoolOut);
    KeyStore store = KeyStore.getInstance("PKCS12");
    try (InputStream in = Files.newInputStream(ks)) { store.load(in, "android".toCharArray()); }
    return new SigningMaterial((PrivateKey) store.getKey("test", "android".toCharArray()), (X509Certificate) store.getCertificate("test"));
  }

  private static Path makeShell(Path apk, boolean includeDex) throws Exception {
    try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(apk))) {
      put(out, "AndroidManifest.xml", "manifest".getBytes(StandardCharsets.UTF_8));
      put(out, "resources.arsc", "resources".getBytes(StandardCharsets.UTF_8));
      if (includeDex) put(out, "classes.dex", "dex".getBytes(StandardCharsets.UTF_8));
      put(out, "assets/www/index.html", "old".getBytes(StandardCharsets.UTF_8));
      put(out, "META-INF/OLD.RSA", "old-signature".getBytes(StandardCharsets.UTF_8));
    }
    return apk;
  }

  private static void put(ZipOutputStream out, String name, byte[] data) throws Exception {
    ZipEntry e = new ZipEntry(name); out.putNextEntry(e); out.write(data); out.closeEntry();
  }

  private static void putStored(ZipOutputStream out, String name, byte[] data) throws Exception {
    CRC32 crc = new CRC32(); crc.update(data); ZipEntry e = new ZipEntry(name); e.setMethod(ZipEntry.STORED); e.setSize(data.length); e.setCompressedSize(data.length); e.setCrc(crc.getValue()); out.putNextEntry(e); out.write(data); out.closeEntry();
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
