package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.*;
import java.util.zip.*;

public final class ExistingApkUpdateEngineSelfTest {
  private static final int CHUNK_XML=0x0003, CHUNK_STRING_POOL=0x0001, CHUNK_RESOURCE_MAP=0x0180, CHUNK_START_ELEMENT=0x0102;
  private static final int TYPE_STRING=0x03, TYPE_INT_DEC=0x10, ATTR_VERSION_CODE=0x0101021b;

  public static void main(String[] args) throws Exception {
    Path root=Files.createTempDirectory("apk-update-engine-");
    try {
      KeyMaterial first=key(root.resolve("first.jks"),"first");
      KeyMaterial other=key(root.resolve("other.jks"),"other");
      Path unsignedExisting=root.resolve("existing-unsigned.apk");
      createExisting(unsignedExisting);
      Path existing=root.resolve("existing.apk");
      V1ApkSigner.sign(unsignedExisting,existing,first.key,first.cert,"CERT");
      ApkV1Verifier.verify(existing);

      ExistingApkSignerGuard.requireSameV1Signer(existing,first.cert);
      try {
        ExistingApkSignerGuard.requireSameV1Signer(existing,other.cert);
        throw new AssertionError("different signer accepted");
      } catch (TemplateException e) {
        check(e.code()==TemplateErrorCode.SIGNATURE_VERIFY_FAILED,"signer mismatch stable code");
      }

      Path project=root.resolve("project"); Files.createDirectories(project.resolve("js"));
      Files.writeString(project.resolve("index.html"),"<main>UPGRADE</main>");
      Files.writeString(project.resolve("js/app.js"),"window.upgraded=true");
      Path finalApk=root.resolve("updated.apk");
      ExistingApkUpdateEngine.UpdateEvidence evidence=ExistingApkUpdateEngine.updatePreparedProject(
          existing,project,List.of("index.html","js/app.js"),"index.html",root.resolve("attempts"),first.key,first.cert,finalApk);

      check(Files.isRegularFile(finalApk),"final APK published");
      ApkV1Verifier.verify(finalApk);
      ExistingApkSignerGuard.requireSameV1Signer(finalApk,first.cert);
      check(evidence.packageName().equals("com.example.keep"),"package evidence preserved");
      check(evidence.previousVersionCode()==7 && evidence.newVersionCode()==8,"version evidence incremented");
      check(evidence.signerCertificateSha256().equals(Hashing.hex(Hashing.sha256(first.cert.getEncoded()))),"signer evidence");
      try(ZipFile zip=new ZipFile(finalApk.toFile())){
        BinaryManifestVersionBumper.ManifestInfo info=BinaryManifestVersionBumper.inspect(read(zip,"AndroidManifest.xml"));
        check(info.packageName().equals("com.example.keep")&&info.versionCode()==8,"signed output identity preserved");
        check(new String(read(zip,"assets/html/index.html"),StandardCharsets.UTF_8).equals("<main>UPGRADE</main>"),"new html signed");
        check(zip.getEntry("assets/html/old.js")==null,"old web content removed");
        check(Arrays.equals(read(zip,"res/mipmap/icon.png"),new byte[]{1,2,3,4}),"icon preserved");
        check(Arrays.equals(read(zip,"res/drawable/splash.png"),new byte[]{5,6,7}),"splash preserved");
        String config=new String(read(zip,"assets/app_config.json"),StandardCharsets.UTF_8);
        check(config.contains("\"nativeSetting\":\"keep\""),"native config preserved");
      }

      byte[] good=Files.readAllBytes(finalApk);
      try {
        ExistingApkUpdateEngine.updatePreparedProject(existing,project,List.of("index.html","js/app.js"),"index.html",root.resolve("attempts2"),other.key,other.cert,finalApk);
        throw new AssertionError("wrong signer update accepted");
      } catch (TemplateException e) {
        check(e.code()==TemplateErrorCode.SIGNATURE_VERIFY_FAILED,"wrong signer rejected");
      }
      check(Arrays.equals(good,Files.readAllBytes(finalApk)),"failed update preserves last good APK");
      System.out.println("EXISTING_APK_UPDATE_ENGINE_SELF_TEST_PASS");
    } finally { deleteTree(root); }
  }

  private static KeyMaterial key(Path store,String alias) throws Exception {
    Process p=new ProcessBuilder("keytool","-genkeypair","-alias",alias,"-keyalg","RSA","-keysize","2048","-validity","3650","-dname","CN=APK Builder Test","-keystore",store.toString(),"-storepass","changeit","-keypass","changeit","-noprompt").redirectErrorStream(true).start();
    String output=new String(p.getInputStream().readAllBytes(),StandardCharsets.UTF_8); if(p.waitFor()!=0) throw new AssertionError("keytool failed: "+output);
    KeyStore ks=KeyStore.getInstance("JKS"); try(InputStream in=Files.newInputStream(store)){ks.load(in,"changeit".toCharArray());}
    PrivateKey key=(PrivateKey)ks.getKey(alias,"changeit".toCharArray()); X509Certificate cert=(X509Certificate)ks.getCertificate(alias); return new KeyMaterial(key,cert);
  }
  private record KeyMaterial(PrivateKey key,X509Certificate cert){}

  private static void createExisting(Path apk)throws Exception{
    try(ZipOutputStream out=new ZipOutputStream(Files.newOutputStream(apk))){
      add(out,"AndroidManifest.xml",manifest("com.example.keep",7)); add(out,"classes.dex",new byte[]{'d','e','x','\n','0','3','5',0}); add(out,"resources.arsc",new byte[]{2,0,12,0});
      add(out,"res/mipmap/icon.png",new byte[]{1,2,3,4}); add(out,"res/drawable/splash.png",new byte[]{5,6,7});
      add(out,"assets/app_config.json","{\"appName\":\"Keep\",\"packageName\":\"com.example.keep\",\"htmlConfig\":{\"entryFile\":\"index.html\"},\"nativeSetting\":\"keep\"}".getBytes(StandardCharsets.UTF_8));
      add(out,"assets/html/index.html","OLD".getBytes(StandardCharsets.UTF_8)); add(out,"assets/html/old.js","OLDJS".getBytes(StandardCharsets.UTF_8));
    }
  }
  private static byte[] manifest(String pkg,int versionCode)throws Exception{List<String> strings=List.of("manifest","package",pkg,"versionCode");byte[] pool=utf8StringPool(strings);ByteBuffer map=ByteBuffer.allocate(8+strings.size()*4).order(ByteOrder.LITTLE_ENDIAN);map.putShort((short)CHUNK_RESOURCE_MAP).putShort((short)8).putInt(map.capacity());map.putInt(0).putInt(0).putInt(0).putInt(ATTR_VERSION_CODE);ByteBuffer start=ByteBuffer.allocate(76).order(ByteOrder.LITTLE_ENDIAN);start.putShort((short)CHUNK_START_ELEMENT).putShort((short)16).putInt(76).putInt(1).putInt(-1).putInt(-1).putInt(0).putShort((short)20).putShort((short)20).putShort((short)2).putShort((short)0).putShort((short)0).putShort((short)0);putStringAttr(start,-1,1,2);putIntAttr(start,-1,3,versionCode);int total=8+pool.length+map.capacity()+start.capacity();ByteBuffer xml=ByteBuffer.allocate(total).order(ByteOrder.LITTLE_ENDIAN);xml.putShort((short)CHUNK_XML).putShort((short)8).putInt(total).put(pool).put(map.array()).put(start.array());return xml.array();}
  private static void putStringAttr(ByteBuffer b,int ns,int name,int value){b.putInt(ns).putInt(name).putInt(value).putShort((short)8).put((byte)0).put((byte)TYPE_STRING).putInt(value);} private static void putIntAttr(ByteBuffer b,int ns,int name,int value){b.putInt(ns).putInt(name).putInt(-1).putShort((short)8).put((byte)0).put((byte)TYPE_INT_DEC).putInt(value);}
  private static byte[] utf8StringPool(List<String> strings)throws Exception{ByteArrayOutputStream data=new ByteArrayOutputStream();int[] offsets=new int[strings.size()];for(int i=0;i<strings.size();i++){offsets[i]=data.size();byte[] bytes=strings.get(i).getBytes(StandardCharsets.UTF_8);data.write(strings.get(i).length());data.write(bytes.length);data.write(bytes);data.write(0);}while((data.size()&3)!=0)data.write(0);int header=28,start=header+offsets.length*4,size=start+data.size();ByteBuffer b=ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);b.putShort((short)CHUNK_STRING_POOL).putShort((short)header).putInt(size).putInt(strings.size()).putInt(0).putInt(0x100).putInt(start).putInt(0);for(int off:offsets)b.putInt(off);b.put(data.toByteArray());return b.array();}
  private static void add(ZipOutputStream out,String name,byte[] data)throws Exception{ZipEntry e=new ZipEntry(name);e.setTime(315532800000L);out.putNextEntry(e);out.write(data);out.closeEntry();}
  private static byte[] read(ZipFile zip,String name)throws Exception{ZipEntry e=zip.getEntry(name);if(e==null)throw new AssertionError("missing "+name);try(InputStream in=zip.getInputStream(e)){return in.readAllBytes();}}
  private static void check(boolean v,String m){if(!v)throw new AssertionError(m);} private static void deleteTree(Path root)throws Exception{if(!Files.exists(root))return;try(var w=Files.walk(root)){for(Path p:w.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(p);}}
}
