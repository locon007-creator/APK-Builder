#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: apply-two-step-update-flow.py <web-to-app-source-root>")

root = Path(sys.argv[1]).resolve()
dialog = root / "app/src/main/java/com/webtoapp/ui/wizard/UpdateExistingApkDialog.kt"
build = root / "app/build.gradle.kts"
if not dialog.is_file() or not build.is_file():
    raise SystemExit("APK Builder update feature must be injected first")

code = r'''package com.webtoapp.ui.wizard

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
import androidx.compose.material.icons.outlined.CheckCircle
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
import com.osulsa.apkbuilder.engine.ProjectArchive
import com.osulsa.apkbuilder.engine.ZipAlignmentVerifier
import com.webtoapp.core.apkbuilder.JarSigner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.ZipFile

private const val MAX_APK_INPUT_BYTES = 512L * 1024L * 1024L
private const val MAX_ZIP_INPUT_BYTES = 128L * 1024L * 1024L

private data class ExistingApkInfo(
    val file: File,
    val displayName: String,
    val packageName: String,
    val versionCode: Int,
)

private data class PreparedUpdateProject(
    val zipFileName: String,
    val projectRoot: java.nio.file.Path,
    val entryFile: String,
    val files: List<String>,
    val extractionDir: File,
)

private data class UpdateBuildResult(
    val file: File,
    val packageName: String,
    val oldVersionCode: Int,
    val newVersionCode: Int,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdateExistingApkDialog(onDismiss: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var existingInfo by remember { mutableStateOf<ExistingApkInfo?>(null) }
    var project by remember { mutableStateOf<PreparedUpdateProject?>(null) }
    var output by remember { mutableStateOf<File?>(null) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val apkPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            busy = true
            error = null
            status = "Checking the APK…"
            try {
                val info = withContext(Dispatchers.IO) {
                    val copied = copyUriToCache(context, uri, "existing-apk", ".apk", MAX_APK_INPUT_BYTES)
                        ?: error("Could not read the existing APK.")
                    inspectExistingApk(context, copied, displayName(context, uri) ?: copied.name)
                }
                project?.extractionDir?.deleteRecursively()
                existingInfo = info
                project = null
                output = null
                status = null
            } catch (e: Exception) {
                existingInfo = null
                project?.extractionDir?.deleteRecursively()
                project = null
                output = null
                status = null
                error = e.message ?: "Could not validate the existing APK."
            } finally {
                busy = false
            }
        }
    }

    val zipPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && existingInfo != null) scope.launch {
            busy = true
            error = null
            status = "Checking the update ZIP…"
            try {
                val prepared = withContext(Dispatchers.IO) { prepareUpdateZip(context, uri) }
                project?.extractionDir?.deleteRecursively()
                project = prepared
                output = null
                status = null
            } catch (e: Exception) {
                project?.extractionDir?.deleteRecursively()
                project = null
                output = null
                status = null
                error = e.message ?: "Could not prepare the update ZIP."
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
                    } ?: error("Could not open the selected save location.")
                }
                status = "Update APK saved. Install it over the existing app to keep its data."
            } catch (e: Exception) {
                error = e.message ?: "Could not save the Update APK."
            } finally {
                busy = false
            }
        }
    }

    Dialog(
        onDismissRequest = { if (!busy) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(
                topBar = {
                    TopAppBar(
                        title = { Text("Update Existing APK", fontWeight = FontWeight.Bold) },
                        navigationIcon = {
                            TextButton(onClick = onDismiss, enabled = !busy) { Text("Close") }
                        },
                    )
                },
            ) { padding ->
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .verticalScroll(rememberScrollState())
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Text(
                        "Upgrade an app without setting up its name, icon, splash or Android options again.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    UpdateStepCard(ready = existingInfo != null) {
                        Text("Step 1 of 2", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.height(4.dp))
                        Text("Choose the APK you want to upgrade", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(
                            "Pick the APK you already built and kept on your phone. We verify it before the ZIP step opens.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        existingInfo?.let { info ->
                            ReadyRow("${info.displayName}  •  v${info.versionCode}")
                            Text(
                                info.packageName,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Button(
                            onClick = { apkPicker.launch(arrayOf("application/vnd.android.package-archive", "application/octet-stream")) },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Outlined.Android, null)
                            Spacer(Modifier.width(8.dp))
                            Text(if (existingInfo == null) "Choose Existing APK" else "Change Existing APK")
                        }
                    }

                    UpdateStepCard(ready = project != null) {
                        Text("Step 2 of 2", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.height(4.dp))
                        Text("Choose the ZIP with your updated app", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(
                            if (existingInfo == null)
                                "Complete Step 1 first. Then add the new ZIP that should replace the app's web content."
                            else
                                "Now choose the new HTML/CSS/JS ZIP you want to put inside that APK.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        project?.let { prepared -> ReadyRow(prepared.zipFileName) }
                        Button(
                            onClick = { zipPicker.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")) },
                            enabled = !busy && existingInfo != null,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Outlined.FolderZip, null)
                            Spacer(Modifier.width(8.dp))
                            Text(if (project == null) "Choose Update ZIP" else "Change Update ZIP")
                        }
                    }

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
                            val apk = existingInfo ?: return@Button
                            val zip = project ?: return@Button
                            scope.launch {
                                busy = true
                                error = null
                                status = "Building and verifying the Update APK…"
                                try {
                                    val result = withContext(Dispatchers.IO) { buildContentOnlyUpdate(context, apk, zip) }
                                    output = result.file
                                    status = "Update verified: ${result.packageName}  v${result.oldVersionCode} → v${result.newVersionCode}."
                                } catch (e: Exception) {
                                    output = null
                                    error = e.message ?: "Update failed."
                                    status = null
                                } finally {
                                    busy = false
                                }
                            }
                        },
                        enabled = !busy && existingInfo != null && project != null,
                        modifier = Modifier.fillMaxWidth().height(56.dp),
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
                            modifier = Modifier.fillMaxWidth().height(52.dp),
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

@Composable
private fun UpdateStepCard(ready: Boolean, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (ready) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
    }
}

@Composable
private fun ReadyRow(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.CheckCircle, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(text, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

private fun inspectExistingApk(context: Context, apk: File, name: String): ExistingApkInfo {
    val signer = JarSigner(context)
    val expectedSigner = signer.getCertificateSignatureHash()
    val verification = ApkVerifier.Builder(apk).build().verify()
    if (!verification.isVerified) error("The APK signature is invalid.")
    val cert = verification.signerCertificates.singleOrNull()
        ?: error("The APK must have exactly one signer.")
    val actualSigner = MessageDigest.getInstance("SHA-256").digest(cert.encoded)
    if (!actualSigner.contentEquals(expectedSigner)) {
        error("This APK was signed by a different key. APK Builder cannot create a seamless update for it with the current signing key.")
    }
    ZipFile(apk).use { zip ->
        val manifest = zip.getEntry("AndroidManifest.xml") ?: error("The APK manifest is missing.")
        val info = zip.getInputStream(manifest).use { BinaryManifestVersionBumper.inspect(it.readBytes()) }
        return ExistingApkInfo(apk, name, info.packageName(), info.versionCode())
    }
}

private fun prepareUpdateZip(context: Context, uri: Uri): PreparedUpdateProject {
    val name = displayName(context, uri) ?: "update.zip"
    val archive = copyUriToCache(context, uri, "update-project", ".zip", MAX_ZIP_INPUT_BYTES)
        ?: error("Could not read the update ZIP.")
    val extractionDir = File(context.cacheDir, "apk_builder_update_projects/${UUID.randomUUID()}")
    val prepared = try {
        ProjectArchive.prepare(archive.toPath(), extractionDir.toPath())
    } catch (e: Exception) {
        extractionDir.deleteRecursively()
        throw e
    }
    return PreparedUpdateProject(
        zipFileName = name,
        projectRoot = prepared.projectRoot(),
        entryFile = prepared.entryFile(),
        files = prepared.files(),
        extractionDir = extractionDir,
    )
}

private fun buildContentOnlyUpdate(
    context: Context,
    existing: ExistingApkInfo,
    project: PreparedUpdateProject,
): UpdateBuildResult {
    val signer = JarSigner(context)
    val expectedSigner = signer.getCertificateSignatureHash()
    val work = File(context.cacheDir, "apk_builder_updates/${UUID.randomUUID()}").apply { mkdirs() }
    val unsigned = File(work, "update-unsigned.apk")
    val signed = File(work, "update-signed.apk")
    val finalDir = File(context.filesDir, "verified_updates").apply { mkdirs() }
    val finalApk = File(finalDir, "update-${System.currentTimeMillis()}.apk")

    val prepared = ExistingApkWebUpdater.prepareUnsigned(
        existing.file.toPath(), project.projectRoot, project.files, project.entryFile, unsigned.toPath(),
    )
    ZipAlignmentVerifier.verify(unsigned.toPath())
    if (!signer.sign(unsigned, signed)) error("APK signing failed.")
    ZipAlignmentVerifier.verify(signed.toPath())
    verifySignedUpdate(signed, expectedSigner, prepared, project)

    AtomicApkPublisher.publish(signed.toPath(), finalApk.toPath()) { candidate ->
        ZipAlignmentVerifier.verify(candidate)
        verifySignedUpdate(candidate.toFile(), expectedSigner, prepared, project)
    }
    return UpdateBuildResult(finalApk, prepared.packageName(), prepared.previousVersionCode(), prepared.newVersionCode())
}

private fun verifySignedUpdate(
    apk: File,
    expectedSigner: ByteArray,
    prepared: ExistingApkWebUpdater.UpdateResult,
    project: PreparedUpdateProject,
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
        for (relative in project.files) {
            val entry = zip.getEntry("assets/html/$relative") ?: error("Update APK is missing $relative")
            val expected = java.nio.file.Files.readAllBytes(project.projectRoot.resolve(relative.replace('/', File.separatorChar)))
            val actual = zip.getInputStream(entry).use { it.readBytes() }
            if (!expected.contentEquals(actual)) error("Update APK changed $relative during packaging.")
        }
    }
}

private fun copyUriToCache(
    context: Context,
    uri: Uri,
    prefix: String,
    suffix: String,
    maxBytes: Long,
): File? {
    return try {
        val dir = File(context.cacheDir, "apk_builder_input").apply { mkdirs() }
        val file = File(dir, "$prefix-${System.currentTimeMillis()}$suffix")
        val input = context.contentResolver.openInputStream(uri) ?: return null
        var total = 0L
        input.use { source ->
            file.outputStream().use { output ->
                val buffer = ByteArray(32 * 1024)
                while (true) {
                    val read = source.read(buffer)
                    if (read < 0) break
                    total += read
                    if (total > maxBytes) error("Selected file is too large for a safe on-device update.")
                    output.write(buffer, 0, read)
                }
            }
        }
        file.takeIf { it.isFile && it.length() > 0L }
    } catch (e: Exception) {
        throw e
    }
}

private fun displayName(context: Context, uri: Uri): String? = try {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    }
} catch (_: Exception) { null }

private fun updateFileName(file: File): String = "${file.nameWithoutExtension}-verified.apk"
'''

dialog.write_text(code)

build_text = build.read_text()
if "versionCode = 511" not in build_text or 'versionName = "5.1.1"' not in build_text:
    raise SystemExit("5.1.1 version markers not found")
build_text = build_text.replace("versionCode = 511", "versionCode = 520", 1)
build_text = build_text.replace('versionName = "5.1.1"', 'versionName = "5.2.0"', 1)
build.write_text(build_text)

print("safe two-step update flow applied")
