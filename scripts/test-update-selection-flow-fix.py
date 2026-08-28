#!/usr/bin/env python3
from pathlib import Path
import subprocess
import tempfile

FIXER = Path(__file__).with_name("apply-update-selection-flow-fix.py")

fixture = r'''package com.webtoapp.ui.wizard

@Composable
fun ApkBuilderWizard() {
    var isBusy by remember { mutableStateOf(false) }
    var showUpdateExisting by remember { mutableStateOf(false) }
    var source by remember { mutableStateOf<WizardSource?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val sourceReady = when (source) {
        WizardSource.WEBSITE -> WizardRules.isValidWebsite(websiteUrl)
        WizardSource.HTML_FILE -> htmlFile?.let { File(it.path).canRead() && File(it.path).length() > 0L } == true
        WizardSource.ZIP_PROJECT -> zipAnalysis?.htmlFiles?.isNotEmpty() == true
        null -> false
    }

    Button(
        onClick = {
            when (step) {
                WizardStep.SOURCE -> {
                    if (source == WizardSource.WEBSITE && !WizardRules.isValidWebsite(websiteUrl)) errorMessage = ApkBuilderStrings.invalidWebsite
                    else { errorMessage = null; step = WizardRules.next(step) }
                }
                WizardStep.IDENTITY, WizardStep.SPLASH -> { errorMessage = null; step = WizardRules.next(step) }
                WizardStep.CONFIRM -> createAndBuild()
                WizardStep.CREATING -> Unit
            }
        },
        enabled = !isBusy && WizardRules.canContinue(step, sourceReady, appName, iconPath != null, splashPath != null),
    ) { Text(ApkBuilderStrings.continueLabel) }

    when (step) {
        WizardStep.SOURCE -> SourceStep(
            source, websiteUrl, htmlFile, zipAnalysis, isBusy,
            onSource = { source = it; errorMessage = null },
            onWebsiteUrl = { websiteUrl = it; source = WizardSource.WEBSITE },
            onHtml = { htmlPicker.launch(arrayOf("text/html", "application/xhtml+xml", "text/plain")) },
            onZip = { zipPicker.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")) },
            onUpdateExisting = { showUpdateExisting = true },
        )
        else -> Unit
    }
}

@Composable
private fun SourceStep(
    source: WizardSource?, websiteUrl: String, htmlFile: HtmlFile?, zipAnalysis: ZipProjectImporter.ZipProjectAnalysis?, isBusy: Boolean,
    onSource: (WizardSource) -> Unit, onWebsiteUrl: (String) -> Unit, onHtml: () -> Unit, onZip: () -> Unit,
    onUpdateExisting: () -> Unit,
) {
    Text(ApkBuilderStrings.intro, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Card(
        modifier = Modifier.fillMaxWidth().clickable(enabled = !isBusy, onClick = onUpdateExisting),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Row(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.SystemUpdateAlt, null, modifier = Modifier.size(30.dp), tint = MaterialTheme.colorScheme.secondary)
            Column(Modifier.padding(start = 16.dp).weight(1f)) {
                Text("Update Existing APK", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Keep its icon, splash, Android setup and saved app data. Replace only the updated web ZIP.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
'''

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    wizard = root / "app/src/main/java/com/webtoapp/ui/wizard/ApkBuilderWizard.kt"
    wizard.parent.mkdir(parents=True)
    wizard.write_text(fixture)
    build = root / "app/build.gradle.kts"
    build.write_text('versionCode = 510\nversionName = "5.1.0"\n')

    subprocess.run(["python3", str(FIXER), str(root)], check=True)

    out = wizard.read_text()
    build_out = build.read_text()

    assert "var updateExistingSelected by remember { mutableStateOf(false) }" in out
    assert "val sourceReady = updateExistingSelected || when (source)" in out
    assert "if (updateExistingSelected) { showUpdateExisting = true }" in out
    assert "onSource = { updateExistingSelected = false; source = it; errorMessage = null }" in out
    assert "onWebsiteUrl = { updateExistingSelected = false; websiteUrl = it; source = WizardSource.WEBSITE }" in out
    assert "onUpdateExisting = { updateExistingSelected = true; source = null; errorMessage = null }" in out
    assert "source, websiteUrl, htmlFile, zipAnalysis, updateExistingSelected, isBusy" in out
    assert "SourceCard(" in out
    assert '"Update Existing APK"' in out
    assert "updateExistingSelected," in out
    assert ") { onUpdateExisting() }" in out
    assert "versionCode = 511" in build_out
    assert 'versionName = "5.1.1"' in build_out

print("UPDATE_SELECTION_FLOW_FIX_TEST_PASS")
