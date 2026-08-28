#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: apply-save-apk-action.py <web-to-app-source-root>')

root = Path(sys.argv[1]).resolve()
screen = root / 'app/src/main/java/com/webtoapp/ui/screens/BuildApkScreen.kt'
if not screen.is_file():
    raise SystemExit('BuildApkScreen.kt not found')

text = screen.read_text()

package_needle = 'package com.webtoapp.ui.screens\n\n'
if package_needle not in text:
    raise SystemExit('package import insertion point not found')
text = text.replace(
    package_needle,
    package_needle +
    'import androidx.activity.compose.rememberLauncherForActivityResult\n' +
    'import androidx.activity.result.contract.ActivityResultContracts\n',
    1,
)

if 'import androidx.compose.material.icons.outlined.Share\n' not in text:
    raise SystemExit('share icon import not found')
text = text.replace(
    'import androidx.compose.material.icons.outlined.Share\n',
    'import androidx.compose.material.icons.outlined.SaveAlt\n',
    1,
)

helper_import_anchor = 'import com.webtoapp.core.apkbuilder.ApkExportPreflightReport\n'
if helper_import_anchor not in text:
    raise SystemExit('APK helper import insertion point not found')
text = text.replace(
    helper_import_anchor,
    helper_import_anchor + 'import com.webtoapp.core.apkbuilder.ApkFileSaver\n',
    1,
)

state_needle = '''    val context = LocalContext.current\n    val clipboardManager = LocalClipboardManager.current\n\n'''
if state_needle not in text:
    raise SystemExit('BuildSummaryCard state insertion point not found')
state_replacement = '''    val context = LocalContext.current\n    val clipboardManager = LocalClipboardManager.current\n    val saveScope = rememberCoroutineScope()\n    val saveApkLauncher = rememberLauncherForActivityResult(\n        ActivityResultContracts.CreateDocument("application/vnd.android.package-archive")\n    ) { uri ->\n        if (uri != null) {\n            saveScope.launch {\n                val saved = withContext(Dispatchers.IO) {\n                    runCatching {\n                        val output = context.contentResolver.openOutputStream(uri, "w")\n                            ?: error("Could not open selected destination")\n                        output.use { ApkFileSaver.copyApk(apkFile, it) }\n                    }.isSuccess\n                }\n                android.widget.Toast.makeText(\n                    context,\n                    if (saved) "APK saved to your device" else "Could not save APK",\n                    android.widget.Toast.LENGTH_SHORT\n                ).show()\n            }\n        }\n    }\n\n'''
text = text.replace(state_needle, state_replacement, 1)

old_action = '''                androidx.compose.material3.FilledTonalButton(\n                    onClick = { openApkWithChooser(context, apkFile) },\n                    contentPadding = PaddingValues(\n                        horizontal = 12.dp, vertical = 6.dp\n                    )\n                ) {\n                    Icon(Icons.Outlined.Share, null, Modifier.size(16.dp))\n                    Spacer(Modifier.width(6.dp))\n                    Text(Strings.buildSummaryOpenWith, style = MaterialTheme.typography.labelMedium)\n                }'''
new_action = '''                androidx.compose.material3.FilledTonalButton(\n                    onClick = {\n                        saveApkLauncher.launch(\n                            ApkFileSaver.suggestedFileName(webApp.name, versionName)\n                        )\n                    },\n                    contentPadding = PaddingValues(\n                        horizontal = 12.dp, vertical = 6.dp\n                    )\n                ) {\n                    Icon(Icons.Outlined.SaveAlt, null, Modifier.size(16.dp))\n                    Spacer(Modifier.width(6.dp))\n                    Text("Save APK", style = MaterialTheme.typography.labelMedium)\n                }'''
if old_action not in text:
    raise SystemExit('existing Open/Share APK action not found')
text = text.replace(old_action, new_action, 1)
screen.write_text(text)

helper = root / 'app/src/main/java/com/webtoapp/core/apkbuilder/ApkFileSaver.kt'
helper.write_text('''package com.webtoapp.core.apkbuilder\n\nimport java.io.File\nimport java.io.OutputStream\n\ninternal object ApkFileSaver {\n    fun suggestedFileName(appName: String, versionName: String): String {\n        val base = sanitize(appName).ifBlank { "app" }\n        val version = sanitize(versionName)\n        return if (version.isBlank()) "$base.apk" else "$base-$version.apk"\n    }\n\n    fun copyApk(source: File, output: OutputStream) {\n        require(source.isFile && source.length() > 0L) { "Verified APK file is missing or empty" }\n        source.inputStream().use { input -> input.copyTo(output) }\n        output.flush()\n    }\n\n    private fun sanitize(value: String): String = value.trim()\n        .replace(Regex("[^A-Za-z0-9._-]+"), "-")\n        .trim('-', '.', '_')\n}\n''')

test = root / 'app/src/test/java/com/webtoapp/core/apkbuilder/ApkFileSaverTest.kt'
test.parent.mkdir(parents=True, exist_ok=True)
test.write_text('''package com.webtoapp.core.apkbuilder\n\nimport com.google.common.truth.Truth.assertThat\nimport org.junit.Test\nimport java.io.ByteArrayOutputStream\nimport java.io.File\n\nclass ApkFileSaverTest {\n    @Test\n    fun `suggested file name is safe and useful`() {\n        assertThat(ApkFileSaver.suggestedFileName("My App", "1.2.3")).isEqualTo("My-App-1.2.3.apk")\n        assertThat(ApkFileSaver.suggestedFileName("  ", "")).isEqualTo("app.apk")\n        assertThat(ApkFileSaver.suggestedFileName("Road/Log: Pro", "2 beta")).isEqualTo("Road-Log-Pro-2-beta.apk")\n    }\n\n    @Test\n    fun `saving copies exact bytes and keeps original apk`() {\n        val source = File.createTempFile("apk-save", ".apk")\n        val original = byteArrayOf(1, 2, 3, 4, 5, 9, 8, 7)\n        source.writeBytes(original)\n        val output = ByteArrayOutputStream()\n\n        ApkFileSaver.copyApk(source, output)\n\n        assertThat(output.toByteArray()).isEqualTo(original)\n        assertThat(source.exists()).isTrue()\n        assertThat(source.readBytes()).isEqualTo(original)\n    }\n}\n''')

print('APK Builder Save APK action and regression tests applied')
