package com.osulsa.apkbuilder.engine;
import java.nio.charset.StandardCharsets; import java.nio.file.*; import java.util.zip.*;
public final class ApkProjectInjectorSelfTest {
  public static void main(String[] args) throws Exception {
    Path root=Files.createTempDirectory("apk-project-inject-"); Path template=root.resolve("template.apk"); makeTemplate(template);
    Path project=root.resolve("project"); Files.createDirectories(project.resolve("css")); Files.createDirectories(project.resolve("js"));
    Files.writeString(project.resolve("index.html"),"<link href='css/app.css'><script src='js/app.js'></script>"); Files.writeString(project.resolve("css/app.css"),"body{color:red}"); Files.writeString(project.resolve("js/app.js"),"window.OK=true");
    Path out=root.resolve("out.apk"); ApkProjectInjector.injectProject(template,out,project,"index.html","com.osulsa.generated");
    try(ZipFile z=new ZipFile(out.toFile())){ require(z.getEntry("assets/html/index.html")!=null,"index injected"); require(z.getEntry("assets/html/css/app.css")!=null,"css injected"); require(z.getEntry("assets/html/js/app.js")!=null,"js injected"); require(z.getEntry("assets/html/old.js")==null,"old html payload removed"); require(z.getEntry("META-INF/OLD.RSA")==null,"old signature removed"); String config=new String(z.getInputStream(z.getEntry("assets/app_config.json")).readAllBytes(),StandardCharsets.UTF_8); require(config.contains("\"entryFile\":\"index.html\""),"config entry points to project index"); }
    expect(TemplateErrorCode.PATCH_ASSETS_FAILED,()->ApkProjectInjector.injectProject(template,root.resolve("bad.apk"),project,"missing.html","com.osulsa.generated"));
    Path outside=root.resolve("outside.js"); Files.writeString(outside,"outside"); Path link=project.resolve("link.js"); Files.createSymbolicLink(link,outside);
    expect(TemplateErrorCode.PATCH_ASSETS_FAILED,()->ApkProjectInjector.injectProject(template,root.resolve("symlink.apk"),project,"index.html","com.osulsa.generated"));
    System.out.println("APK_PROJECT_INJECTOR_SELF_TEST_PASS");
  }
  private static void makeTemplate(Path apk)throws Exception{try(ZipOutputStream out=new ZipOutputStream(Files.newOutputStream(apk))){put(out,"AndroidManifest.xml","manifest");put(out,"resources.arsc","resources");put(out,"classes.dex","dex");put(out,"assets/html/old.js","old");put(out,"assets/app_config.json","old-config");put(out,"META-INF/OLD.RSA","old-sig");}}
  private static void put(ZipOutputStream out,String name,String value)throws Exception{ZipEntry e=new ZipEntry(name);out.putNextEntry(e);out.write(value.getBytes(StandardCharsets.UTF_8));out.closeEntry();}
  private interface Throwing{void run()throws Exception;} private static void expect(TemplateErrorCode code,Throwing r)throws Exception{try{r.run();throw new AssertionError("Expected "+code);}catch(TemplateException e){require(e.code()==code,"expected "+code+" got "+e.code());}} private static void require(boolean ok,String message){if(!ok)throw new AssertionError(message);}
}
