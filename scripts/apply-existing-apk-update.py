#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: apply-existing-apk-update.py <web-to-app-source-root>')
root = Path(sys.argv[1]).resolve()
app = root / 'app'
wizard = app / 'src/main/java/com/webtoapp/ui/wizard/ApkBuilderWizard.kt'
build = app / 'build.gradle.kts'
if not wizard.is_file() or not build.is_file():
    raise SystemExit('APK Builder historical overlay must be applied first')

build_text = build.read_text()
build_text = build_text.replace('versionCode = 311', 'versionCode = 500')
build_text = build_text.replace('versionName = "3.1.1"', 'versionName = "5.0.0"')
build.write_text(build_text)

update_file = app / 'src/main/java/com/webtoapp/ui/wizard/UpdateExistingApkDialog.kt'
update_file.parent.mkdir(parents=True, exist_ok=True)
update_file.write_text(r'''package com.webtoapp.ui.wizard

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Android
import androidx.compose.material.icons.outlined.FolderZip
import androidx.compose.material.icons.outlined.SaveAlt
import androidx.compose.material.icons.outlined.SystemUpdateAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.android.apksig.ApkVerifier
import com.osulsa.apkbuilder.engine.AtomicApkPublisher
import com.osulsa.apkbuilder.engine.BinaryManifestVersionBumper
import com.osulsa.apkbuilder.engine.ExistingApkWebUpdater
import com.osulsa.apkbuilder.engine.ZipAlignmentVerifier
import com.webtoapp.core.apkbuilder.JarSigner
import com.webtoapp.util.ZipProjectImporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.ZipFile

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdateExistingApkDialog(onDismiss: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var existingApk by remember { mutableStateOf<File?>(null) }
    var existingName by remember { mutableStateOf<String?>(null) }
    var project by remember { mutableStateOf<ZipProjectImporter.ZipProjectAnalysis?>(null) }
    var output by remember { mutableStateOf<File?>(null) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val apkPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            busy = true
            error = null
            val copied = withContext(Dispatchers.IO) { copyUriToCache(context, uri, "existing-apk", ".apk") }
            busy = false
            if (copied == null) error = "Could not read the existing APK."
            else {
                existingApk = copied
                existingName = displayName(context, uri) ?: copied.name
                output = null
                status = null
            }
        }
    }

    val zipPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            busy = true
            error = null
            try {
                val imported = withContext(Dispatchers.IO) { ZipProjectImporter.importZip(context, uri) }
                if (imported.htmlFiles.isEmpty()) error = "The ZIP project does not contain an HTML entry point."
                else {
                    project = imported
                    output = null
                    status = null
                }
            } catch (e: Exception) {
                error = e.message ?: "Could not read the replacement ZIP."
            } finally {
                busy = false
            }
        }
    }

    val savePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/vnd.android.package-archive")
    ) { uri ->
        val ready = output
        if (uri != null && ready != null) scope.launch {
            busy = true
            error = null
            try {
                withContext(Dispatchers.IO) {
                    context.contentResolver.openOutputStream(uri, "w")?.use { out ->
                        ready.inputStream().use { it.copyTo(out) }
                    } ?: error("Could not open destination")
                }
                status = "Update APK saved. Install it over the existing app to keep its data."
            } catch (e: Exception) {
                error = e.message ?: "Could not save the Update APK."
            } finally {
                busy = false
            }
        }
    }

    Dialog(onDismissRequest = { if (!busy) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(
                topBar = {
                    TopAppBar(
                        title = { Text("Update Existing APK", fontWeight = FontWeight.Bold) },
                        navigationIcon = {
                            TextButton(onClick = onDismiss, enabled = !busy) { Text("Close") }
                        }
                    )
                }
            ) { padding ->
                Column(
                    modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Text(
                        "Keep the existing app name, icon, splash, package, permissions and Android setup. Only the packaged web project is replaced, then the version is increased and the APK is re-signed with the same APK Builder key.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    SelectionCard(
                        title = "1. Existing APK",
                        value = existingName ?: "Choose the APK you want to upgrade",
                        icon = { Icon(Icons.Outlined.Android, null) },
                        enabled = !busy,
                        onClick = { apkPicker.launch(arrayOf("application/vnd.android.package-archive", "application/octet-stream")) }
                    )
                    SelectionCard(
                        title = "2. Updated ZIP",
                        value = project?.zipFileName ?: "Choose the new HTML/CSS/JS ZIP",
                        icon = { Icon(Icons.Outlined.FolderZip, null) },
                        enabled = !busy,
                        onClick = { zipPicker.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")) }
                    )

                    error?.let {
                        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                            Text(it, color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.padding(14.dp))
                        }
                    }
                    status?.let {
                        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                            Text(it, modifier = Modifier.padding(14.dp))
                        }
                    }

                    Button(
                        onClick = {
                            val apk = existingApk ?: return@Button
                            val zip = project ?: return@Button
                            scope.launch {
                                busy = true
                                error = null
                                status = "Verifying existing app identity…"
                                try {
                                    val result = withContext(Dispatchers.IO) { buildContentOnlyUpdate(context, apk, zip) }
                                    output = result.file
                                    status = "Update verified: ${result.packageName}  v${result.oldVersionCode} → v${result.newVersionCode}."
                                } catch (e: Exception) {
                                    error = e.message ?: "Update failed."
                                    status = null
                                } finally {
                                    busy = false
                                }
                            }
                        },
                        enabled = !busy && existingApk != null && project != null,
                        modifier = Modifier.fillMaxWidth().height(54.dp)
                    ) {
                        if (busy) CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Outlined.SystemUpdateAlt, null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (busy) "Building Update APK…" else "Build Update APK")
                    }

                    output?.let { ready ->
                        OutlinedButton(
                            onClick = { savePicker.launch(updateFileName(ready)) },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().height(52.dp)
                        ) {
                            Icon(Icons.Outlined.SaveAlt, null)
                            Spacer(Modifier.width(8.dp))
                            Text("Save Update APK")
                        }
                    }
                }
            }
        }
    }
}

private data class UpdateBuildResult(
    val file: File,
    val packageName: String,
    val oldVersionCode: Int,
    val newVersionCode: Int
)

private fun buildContentOnlyUpdate(
    context: Context,
    existingApk: File,
    project: ZipProjectImporter.ZipProjectAnalysis
): UpdateBuildResult {
    val signer = JarSigner(context)
    val expectedSigner = signer.getCertificateSignatureHash()
    val existingVerification = ApkVerifier.Builder(existingApk).build().verify()
    if (!existingVerification.isVerified) error("The existing APK signature is invalid.")
    val existingCert = existingVerification.signerCertificates.singleOrNull()
        ?: error("The existing APK must have exactly one signer.")
    val actualSigner = MessageDigest.getInstance("SHA-256").digest(existingCert.encoded)
    if (!actualSigner.contentEquals(expectedSigner)) {
        error("This APK was signed by a different key. Android cannot install a seamless update unless the original signing key is used.")
    }

    val root = project.extractDir.toPath().toAbsolutePath().normalize()
    val relativeFiles = project.extractDir.walkTopDown()
        .filter { it.isFile }
        .map { root.relativize(it.toPath().toAbsolutePath().normalize()).toString().replace(File.separatorChar, '/') }
        .filter { it.isNotBlank() }
        .sorted()
        .toList()
    if (relativeFiles.isEmpty()) error("The replacement ZIP contains no files.")

    val work = File(context.cacheDir, "apk_builder_updates/${UUID.randomUUID()}").apply { mkdirs() }
    val unsigned = File(work, "update-unsigned.apk")
    val signed = File(work, "update-signed.apk")
    val finalDir = File(context.filesDir, "verified_updates").apply { mkdirs() }
    val finalApk = File(finalDir, "update-${System.currentTimeMillis()}.apk")

    val prepared = ExistingApkWebUpdater.prepareUnsigned(
        existingApk.toPath(), root, relativeFiles, project.entryFile, unsigned.toPath()
    )
    ZipAlignmentVerifier.verify(unsigned.toPath())
    if (!signer.sign(unsigned, signed)) error("APK signing failed.")
    ZipAlignmentVerifier.verify(signed.toPath())
    verifySignedUpdate(signed, expectedSigner, prepared, root, relativeFiles)

    AtomicApkPublisher.publish(signed.toPath(), finalApk.toPath()) { candidate ->
        ZipAlignmentVerifier.verify(candidate)
        verifySignedUpdate(candidate.toFile(), expectedSigner, prepared, root, relativeFiles)
    }
    return UpdateBuildResult(finalApk, prepared.packageName(), prepared.previousVersionCode(), prepared.newVersionCode())
}

private fun verifySignedUpdate(
    apk: File,
    expectedSigner: ByteArray,
    prepared: ExistingApkWebUpdater.UpdateResult,
    root: java.nio.file.Path,
    relativeFiles: List<String>
) {
    val verification = ApkVerifier.Builder(apk).build().verify()
    if (!verification.isVerified) error("The Update APK did not pass Android signature verification.")
    val cert = verification.signerCertificates.singleOrNull() ?: error("Update APK signer is missing.")
    val digest = MessageDigest.getInstance("SHA-256").digest(cert.encoded)
    if (!digest.contentEquals(expectedSigner)) error("Update APK signer changed unexpectedly.")

    ZipFile(apk).use { zip ->
        val manifest = zip.getEntry("AndroidManifest.xml") ?: error("Update APK manifest is missing.")
        val info = zip.getInputStream(manifest).use { BinaryManifestVersionBumper.inspect(it.readBytes()) }
        if (info.packageName() != prepared.packageName() || info.versionCode() != prepared.newVersionCode()) {
            error("Update APK package/version verification failed.")
        }
        for (relative in relativeFiles) {
            val entry = zip.getEntry("assets/html/$relative") ?: error("Update APK is missing $relative")
            val expected = java.nio.file.Files.readAllBytes(root.resolve(relative.replace('/', File.separatorChar)))
            val actual = zip.getInputStream(entry).use { it.readBytes() }
            if (!expected.contentEquals(actual)) error("Update APK changed $relative during packaging.")
        }
    }
}

@Composable
private fun SelectionCard(
    title: String,
    value: String,
    icon: @Composable () -> Unit,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Card(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            icon()
            Column(modifier = Modifier.padding(start = 14.dp).weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold)
                Text(value, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

private fun copyUriToCache(context: Context, uri: Uri, prefix: String, suffix: String): File? = try {
    val dir = File(context.cacheDir, "apk_builder_input").apply { mkdirs() }
    val file = File(dir, "$prefix-${System.currentTimeMillis()}$suffix")
    context.contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { input.copyTo(it) } } ?: return null
    file.takeIf { it.isFile && it.length() > 0L }
} catch (_: Exception) { null }

private fun displayName(context: Context, uri: Uri): String? = try {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    }
} catch (_: Exception) { null }

private fun updateFileName(file: File): String = "${file.nameWithoutExtension}-verified.apk"
''')

text = wizard.read_text()
needle = '    var isBusy by remember { mutableStateOf(false) }\n'
if needle not in text:
    raise SystemExit('wizard state insertion point not found')
text = text.replace(needle, needle + '    var showUpdateExisting by remember { mutableStateOf(false) }\n', 1)

needle = '    Scaffold(\n'
if needle not in text:
    raise SystemExit('wizard scaffold insertion point not found')
text = text.replace(needle, '    if (showUpdateExisting) {\n        UpdateExistingApkDialog(onDismiss = { showUpdateExisting = false })\n    }\n\n' + needle, 1)

old = '''                WizardStep.SOURCE -> SourceStep(\n                    source, websiteUrl, htmlFile, zipAnalysis, isBusy,\n                    onSource = { source = it; errorMessage = null },\n                    onWebsiteUrl = { websiteUrl = it; source = WizardSource.WEBSITE },\n                    onHtml = { htmlPicker.launch(arrayOf("text/html", "application/xhtml+xml", "text/plain")) },\n                    onZip = { zipPicker.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")) },\n                )'''
new = '''                WizardStep.SOURCE -> SourceStep(\n                    source, websiteUrl, htmlFile, zipAnalysis, isBusy,\n                    onSource = { source = it; errorMessage = null },\n                    onWebsiteUrl = { websiteUrl = it; source = WizardSource.WEBSITE },\n                    onHtml = { htmlPicker.launch(arrayOf("text/html", "application/xhtml+xml", "text/plain")) },\n                    onZip = { zipPicker.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")) },\n                    onUpdateExisting = { showUpdateExisting = true },\n                )'''
if old not in text:
    raise SystemExit('SourceStep call not found')
text = text.replace(old, new, 1)

old = '''private fun SourceStep(\n    source: WizardSource?, websiteUrl: String, htmlFile: HtmlFile?, zipAnalysis: ZipProjectImporter.ZipProjectAnalysis?, isBusy: Boolean,\n    onSource: (WizardSource) -> Unit, onWebsiteUrl: (String) -> Unit, onHtml: () -> Unit, onZip: () -> Unit,\n) {'''
new = '''private fun SourceStep(\n    source: WizardSource?, websiteUrl: String, htmlFile: HtmlFile?, zipAnalysis: ZipProjectImporter.ZipProjectAnalysis?, isBusy: Boolean,\n    onSource: (WizardSource) -> Unit, onWebsiteUrl: (String) -> Unit, onHtml: () -> Unit, onZip: () -> Unit,\n    onUpdateExisting: () -> Unit,\n) {'''
if old not in text:
    raise SystemExit('SourceStep signature not found')
text = text.replace(old, new, 1)

needle = '    Text(ApkBuilderStrings.intro, color = MaterialTheme.colorScheme.onSurfaceVariant)\n'
insert = '''    Text(ApkBuilderStrings.intro, color = MaterialTheme.colorScheme.onSurfaceVariant)\n    Card(\n        modifier = Modifier.fillMaxWidth().clickable(enabled = !isBusy, onClick = onUpdateExisting),\n        shape = RoundedCornerShape(18.dp),\n        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),\n    ) {\n        Row(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {\n            Icon(Icons.Outlined.SystemUpdateAlt, null, modifier = Modifier.size(30.dp), tint = MaterialTheme.colorScheme.secondary)\n            Column(Modifier.padding(start = 16.dp).weight(1f)) {\n                Text("Update Existing APK", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)\n                Text("Keep its icon, splash, Android setup and saved app data. Replace only the updated web ZIP.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)\n            }\n        }\n    }\n'''
if needle not in text:
    raise SystemExit('SourceStep intro insertion point not found')
text = text.replace(needle, insert, 1)
wizard.write_text(text)

print('APK Builder existing-APK update UI/service applied')
