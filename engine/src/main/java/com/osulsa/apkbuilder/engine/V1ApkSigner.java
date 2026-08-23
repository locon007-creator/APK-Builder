package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.*;
import java.util.zip.*;

public final class V1ApkSigner {
  private V1ApkSigner() {}
  private record ManifestBundle(byte[] bytes, LinkedHashMap<String, byte[]> sections) {}

  public static void sign(Path unsignedApk, Path signedApk, PrivateKey key, X509Certificate cert, String alias) throws TemplateException {
    try {
      ManifestBundle manifest = createManifest(unsignedApk);
      byte[] sfBytes = createSignatureFile(manifest);
      Signature rsa = Signature.getInstance("SHA256withRSA");
      rsa.initSign(key); rsa.update(sfBytes); byte[] signature = rsa.sign();
      byte[] pkcs7 = createPkcs7(cert, signature);
      rewrite(unsignedApk, signedApk, manifest.bytes(), sfBytes, pkcs7, sanitizeAlias(alias));
    } catch (TemplateException e) { throw e; }
    catch (Exception e) { throw new TemplateException(TemplateErrorCode.SIGNING_FAILED, "APK v1 signing failed", e); }
  }

  private static ManifestBundle createManifest(Path apk) throws Exception {
    ByteArrayOutputStream main = new ByteArrayOutputStream();
    header(main, "Manifest-Version", "1.0");
    header(main, "Created-By", "APK Builder");
    crlf(main);
    LinkedHashMap<String, byte[]> sections = new LinkedHashMap<>();
    try (ZipFile zip = new ZipFile(apk.toFile())) {
      List<? extends ZipEntry> entries = Collections.list(zip.entries());
      entries.sort(Comparator.comparing(ZipEntry::getName));
      for (ZipEntry e : entries) {
        if (e.isDirectory() || ApkHtmlInjector.isSignatureEntry(e.getName())) continue;
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = zip.getInputStream(e)) { byte[] b = new byte[64*1024]; for (int n; (n=in.read(b))>=0;) if (n>0) md.update(b,0,n); }
        ByteArrayOutputStream section = new ByteArrayOutputStream();
        header(section, "Name", e.getName());
        header(section, "SHA-256-Digest", Base64.getEncoder().encodeToString(md.digest()));
        crlf(section);
        sections.put(e.getName(), section.toByteArray());
      }
    }
    ByteArrayOutputStream full = new ByteArrayOutputStream();
    full.writeBytes(main.toByteArray());
    for (byte[] s : sections.values()) full.writeBytes(s);
    return new ManifestBundle(full.toByteArray(), sections);
  }

  private static byte[] createSignatureFile(ManifestBundle manifest) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    header(out, "Signature-Version", "1.0");
    header(out, "Created-By", "APK Builder");
    header(out, "SHA-256-Digest-Manifest", b64(Hashing.sha256(manifest.bytes())));
    crlf(out);
    for (Map.Entry<String,byte[]> e : manifest.sections().entrySet()) {
      header(out, "Name", e.getKey());
      header(out, "SHA-256-Digest", b64(Hashing.sha256(e.getValue())));
      crlf(out);
    }
    return out.toByteArray();
  }

  private static byte[] createPkcs7(X509Certificate cert, byte[] rawSignature) throws Exception {
    byte[] sha256 = Der.algorithm("2.16.840.1.101.3.4.2.1");
    byte[] rsa = Der.algorithm("1.2.840.113549.1.1.1");
    byte[] dataOid = Der.oid("1.2.840.113549.1.7.1");
    byte[] issuerAndSerial = Der.sequence(cert.getIssuerX500Principal().getEncoded(), Der.integer(cert.getSerialNumber()));
    byte[] signerInfo = Der.sequence(Der.integer(java.math.BigInteger.ONE), issuerAndSerial, sha256, rsa, Der.octet(rawSignature));
    byte[] signedData = Der.sequence(Der.integer(java.math.BigInteger.ONE), Der.set(sha256), Der.sequence(dataOid), Der.implicit0(cert.getEncoded()), Der.set(signerInfo));
    return Der.sequence(Der.oid("1.2.840.113549.1.7.2"), Der.explicit0(signedData));
  }

  private static void rewrite(Path unsigned, Path signed, byte[] manifest, byte[] sf, byte[] sig, String alias) throws Exception {
    try (ZipFile zip = new ZipFile(unsigned.toFile());
         AlignedZip.CountingOutputStream count = new AlignedZip.CountingOutputStream(Files.newOutputStream(signed));
         ZipOutputStream out = new ZipOutputStream(count)) {
      // JAR/APK v1 expects the manifest at the beginning; metadata first also avoids JarInputStream inconsistencies.
      add(out, "META-INF/MANIFEST.MF", manifest); add(out, "META-INF/"+alias+".SF", sf); add(out, "META-INF/"+alias+".RSA", sig);
      Enumeration<? extends ZipEntry> en = zip.entries();
      while (en.hasMoreElements()) {
        ZipEntry e = en.nextElement(); if (ApkHtmlInjector.isSignatureEntry(e.getName())) continue;
        ZipEntry copy = AlignedZip.copyMetadata(e, count.count()); out.putNextEntry(copy);
        if (!e.isDirectory()) try (InputStream in = zip.getInputStream(e)) { in.transferTo(out); } out.closeEntry();
      }
    }
  }

  private static void header(ByteArrayOutputStream out, String name, String value) {
    byte[] bytes = (name + ": " + value).getBytes(StandardCharsets.UTF_8);
    int offset = 0; int room = 70; // 70 data bytes + CRLF = 72 bytes on first physical line.
    while (offset < bytes.length) {
      int n = Math.min(room, bytes.length - offset);
      out.write(bytes, offset, n); offset += n; crlf(out);
      if (offset < bytes.length) { out.write(' '); room = 69; }
    }
  }
  private static void crlf(ByteArrayOutputStream out) { out.write('\r'); out.write('\n'); }
  private static String b64(byte[] b) { return Base64.getEncoder().encodeToString(b); }
  private static void add(ZipOutputStream out, String name, byte[] data) throws Exception { ZipEntry e = new ZipEntry(name); e.setTime(AlignedZip.ZIP_TIME); out.putNextEntry(e); out.write(data); out.closeEntry(); }
  private static String sanitizeAlias(String alias) { String a = alias == null ? "CERT" : alias.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9_-]", ""); return a.isEmpty() ? "CERT" : a.substring(0, Math.min(a.length(), 8)); }
}
