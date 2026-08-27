package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public final class ExistingApkWebUpdaterSelfTest {
  private static final int CHUNK_XML = 0x0003;
  private static final int CHUNK_STRING_POOL = 0x0001;
  private static final int CHUNK_RESOURCE_MAP = 0x0180;
  private static final int CHUNK_START_ELEMENT = 0x0102;
  private static final int TYPE_STRING = 0x03;
  private static final int TYPE_INT_DEC = 0x10;
  private static final int ATTR_VERSION_CODE = 0x0101021b;

  public static void main(String[] args) throws Exception {
    Path root = Files.createTempDirectory("existing-apk-update-");
    try {
      Path existing = root.resolve("existing.apk");
      byte[] icon = new byte[]{1,2,3,4,5};
      byte[] splash = new byte[]{9,8,7,6};
      byte[] config = "{\"appName\":\"Keep Me\",\"packageName\":\"com.example.keep\",\"htmlConfig\":{\"entryFile\":\"index.html\"},\"enableNativeBridge\":true}".getBytes(StandardCharsets.UTF_8);
      createExistingApk(existing, icon, splash, config);

      Path project = root.resolve("project");
      Files.createDirectories(project.resolve("css"));
      Files.writeString(project.resolve("index.html"), "<h1>NEW</h1>");
      Files.writeString(project.resolve("css/app.css"), "body{font-size:20px}");
      Path unsigned = root.resolve("updated-unsigned.apk");

      ExistingApkWebUpdater.UpdateResult result = ExistingApkWebUpdater.prepareUnsigned(
          existing, project, List.of("index.html", "css/app.css"), "index.html", unsigned);

      check(result.packageName().equals("com.example.keep"), "package preserved in result");
      check(result.previousVersionCode() == 7, "previous version read");
      check(result.newVersionCode() == 8, "version incremented");

      try (ZipFile zip = new ZipFile(unsigned.toFile())) {
        check(Arrays.equals(read(zip, "res/mipmap/icon.png"), icon), "icon bytes preserved");
        check(Arrays.equals(read(zip, "res/drawable/splash.png"), splash), "splash bytes preserved");
        check(Arrays.equals(read(zip, "assets/app_config.json"), config), "app config preserved exactly");
        check(new String(read(zip, "assets/html/index.html"), StandardCharsets.UTF_8).equals("<h1>NEW</h1>"), "html replaced");
        check(new String(read(zip, "assets/html/css/app.css"), StandardCharsets.UTF_8).equals("body{font-size:20px}"), "nested asset added");
        check(zip.getEntry("assets/html/old.js") == null, "obsolete web asset removed");
        check(zip.getEntry("META-INF/OLD.SF") == null, "old signature removed");
        check(zip.getEntry("META-INF/OLD.RSA") == null, "old signature block removed");
        BinaryManifestVersionBumper.ManifestInfo info = BinaryManifestVersionBumper.inspect(read(zip, "AndroidManifest.xml"));
        check(info.packageName().equals("com.example.keep"), "manifest package unchanged");
        check(info.versionCode() == 8, "manifest version incremented");
      }

      try {
        ExistingApkWebUpdater.prepareUnsigned(existing, project, List.of("../escape.txt"), "index.html", root.resolve("bad.apk"));
        throw new AssertionError("path traversal accepted");
      } catch (TemplateException e) {
        check(e.code() == TemplateErrorCode.PATCH_ASSETS_FAILED, "path traversal stable code");
      }

      System.out.println("EXISTING_APK_WEB_UPDATER_SELF_TEST_PASS");
    } finally {
      deleteTree(root);
    }
  }

  private static void createExistingApk(Path apk, byte[] icon, byte[] splash, byte[] config) throws Exception {
    try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(apk))) {
      add(out, "AndroidManifest.xml", manifest("com.example.keep", 7));
      add(out, "classes.dex", new byte[]{'d','e','x','\n','0','3','5',0});
      add(out, "resources.arsc", new byte[]{2,0,12,0});
      add(out, "res/mipmap/icon.png", icon);
      add(out, "res/drawable/splash.png", splash);
      add(out, "assets/app_config.json", config);
      add(out, "assets/html/index.html", "<h1>OLD</h1>".getBytes(StandardCharsets.UTF_8));
      add(out, "assets/html/old.js", "old()".getBytes(StandardCharsets.UTF_8));
      add(out, "META-INF/OLD.SF", new byte[]{1});
      add(out, "META-INF/OLD.RSA", new byte[]{2});
    }
  }

  private static byte[] manifest(String pkg, int versionCode) throws Exception {
    List<String> strings = List.of("manifest", "package", pkg, "versionCode");
    byte[] pool = utf8StringPool(strings);
    ByteBuffer map = ByteBuffer.allocate(8 + strings.size() * 4).order(ByteOrder.LITTLE_ENDIAN);
    map.putShort((short) CHUNK_RESOURCE_MAP).putShort((short)8).putInt(map.capacity());
    map.putInt(0).putInt(0).putInt(0).putInt(ATTR_VERSION_CODE);

    int attrCount = 2;
    ByteBuffer start = ByteBuffer.allocate(36 + attrCount * 20).order(ByteOrder.LITTLE_ENDIAN);
    start.putShort((short)CHUNK_START_ELEMENT).putShort((short)16).putInt(start.capacity());
    start.putInt(1).putInt(-1).putInt(-1).putInt(0);
    start.putShort((short)20).putShort((short)20).putShort((short)attrCount).putShort((short)0).putShort((short)0).putShort((short)0);
    putStringAttr(start, -1, 1, 2);
    putIntAttr(start, -1, 3, versionCode);

    int total = 8 + pool.length + map.capacity() + start.capacity();
    ByteBuffer xml = ByteBuffer.allocate(total).order(ByteOrder.LITTLE_ENDIAN);
    xml.putShort((short)CHUNK_XML).putShort((short)8).putInt(total);
    xml.put(pool).put(map.array()).put(start.array());
    return xml.array();
  }

  private static void putStringAttr(ByteBuffer b, int ns, int name, int value) {
    b.putInt(ns).putInt(name).putInt(value).putShort((short)8).put((byte)0).put((byte)TYPE_STRING).putInt(value);
  }
  private static void putIntAttr(ByteBuffer b, int ns, int name, int value) {
    b.putInt(ns).putInt(name).putInt(-1).putShort((short)8).put((byte)0).put((byte)TYPE_INT_DEC).putInt(value);
  }

  private static byte[] utf8StringPool(List<String> strings) throws Exception {
    ByteArrayOutputStream data = new ByteArrayOutputStream();
    int[] offsets = new int[strings.size()];
    for (int i=0;i<strings.size();i++) {
      offsets[i] = data.size();
      byte[] bytes = strings.get(i).getBytes(StandardCharsets.UTF_8);
      if (strings.get(i).length() > 127 || bytes.length > 127) throw new IllegalArgumentException("fixture string too long");
      data.write(strings.get(i).length()); data.write(bytes.length); data.write(bytes); data.write(0);
    }
    while ((data.size() & 3) != 0) data.write(0);
    int header = 28;
    int start = header + offsets.length * 4;
    int size = start + data.size();
    ByteBuffer b = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
    b.putShort((short)CHUNK_STRING_POOL).putShort((short)header).putInt(size);
    b.putInt(strings.size()).putInt(0).putInt(0x100).putInt(start).putInt(0);
    for (int off: offsets) b.putInt(off);
    b.put(data.toByteArray());
    return b.array();
  }

  private static void add(ZipOutputStream out, String name, byte[] data) throws Exception {
    ZipEntry e = new ZipEntry(name); e.setTime(315532800000L); out.putNextEntry(e); out.write(data); out.closeEntry();
  }
  private static byte[] read(ZipFile zip, String name) throws Exception {
    ZipEntry e = zip.getEntry(name); if (e == null) throw new AssertionError("missing " + name);
    try (InputStream in = zip.getInputStream(e)) { return in.readAllBytes(); }
  }
  private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
  private static void deleteTree(Path root) throws Exception {
    if (!Files.exists(root)) return;
    try (var walk=Files.walk(root)) { for (Path p: walk.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(p); }
  }
}
