#!/usr/bin/env python3
"""APK Builder 5.3.1: generated APK must inherit the selected app name, never host branding."""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: apply-generated-app-name-fix.py <web-to-app-source-root>")

root = Path(sys.argv[1]).resolve()

arsc = root / "app/src/main/java/com/webtoapp/core/apkbuilder/ArscRebuilder.kt"
if not arsc.is_file():
    raise SystemExit("ArscRebuilder.kt not found")
text = arsc.read_text()

old_patterns = '''            val appNamePatterns = listOf(
                "WebToApp - Convert Any Website to Android App",
                "WebToApp"
            )'''
new_patterns = '''            val appNamePatterns = listOf(
                "WebToApp - Convert Any Website to Android App",
                "WebToApp",
                "APK Builder"
            )'''
if old_patterns not in text:
    raise SystemExit("app name pattern anchor not found")
text = text.replace(old_patterns, new_patterns, 1)

old_fallback = '''                    if (str.trim().startsWith("WebToApp") &&
                        str.length < 100 &&'''
new_fallback = '''                    if ((str.trim().startsWith("WebToApp") || str.trim() == "APK Builder") &&
                        str.length < 100 &&'''
if old_fallback not in text:
    raise SystemExit("app name fallback anchor not found")
text = text.replace(old_fallback, new_fallback, 1)
arsc.write_text(text)

builder = root / "app/src/main/java/com/webtoapp/core/apkbuilder/ApkBuilder.kt"
if not builder.is_file():
    raise SystemExit("ApkBuilder.kt not found")
text = builder.read_text()
old_output = 'val signedApk = File(outputDir, "${sanitizeFileName(webApp.name)}_v${config.versionName}.APK")'
new_output = 'val signedApk = File(outputDir, "${sanitizeFileName(webApp.name)}.apk")'
if old_output not in text:
    raise SystemExit("signed APK filename anchor not found")
text = text.replace(old_output, new_output, 1)
builder.write_text(text)

saver = root / "app/src/main/java/com/webtoapp/core/apkbuilder/ApkFileSaver.kt"
if not saver.is_file():
    raise SystemExit("ApkFileSaver.kt not found")
text = saver.read_text()
old_save = '''        val version = sanitize(versionName)
        return if (version.isBlank()) "$base.apk" else "$base-$version.apk"'''
new_save = '''        return "$base.apk"'''
if old_save not in text:
    raise SystemExit("save filename anchor not found")
text = text.replace(old_save, new_save, 1)
saver.write_text(text)

test = root / "app/src/test/java/com/webtoapp/core/apkbuilder/ApkFileSaverTest.kt"
if test.is_file():
    text = test.read_text()
    text = text.replace(
        'assertThat(ApkFileSaver.suggestedFileName("My App", "1.2.3")).isEqualTo("My-App-1.2.3.apk")',
        'assertThat(ApkFileSaver.suggestedFileName("My App", "1.2.3")).isEqualTo("My-App.apk")'
    )
    text = text.replace(
        'assertThat(ApkFileSaver.suggestedFileName("Road/Log: Pro", "2 beta")).isEqualTo("Road-Log-Pro-2-beta.apk")',
        'assertThat(ApkFileSaver.suggestedFileName("Road/Log: Pro", "2 beta")).isEqualTo("Road-Log-Pro.apk")'
    )
    test.write_text(text)

gradle = root / "app/build.gradle.kts"
if not gradle.is_file():
    raise SystemExit("app/build.gradle.kts not found")
text = gradle.read_text()
old_version = 'versionCode = 530\n        versionName = "5.3.0"'
new_version = 'versionCode = 531\n        versionName = "5.3.1"'
if old_version not in text:
    raise SystemExit("APK Builder 5.3.0 version anchor not found")
text = text.replace(old_version, new_version, 1)
gradle.write_text(text)

print("APK Builder 5.3.1 generated app-name fix applied")
