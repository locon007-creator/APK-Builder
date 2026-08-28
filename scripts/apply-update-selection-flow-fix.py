#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: apply-update-selection-flow-fix.py <web-to-app-source-root>")

root = Path(sys.argv[1]).resolve()
wizard = root / "app/src/main/java/com/webtoapp/ui/wizard/ApkBuilderWizard.kt"
build = root / "app/build.gradle.kts"
if not wizard.is_file() or not build.is_file():
    raise SystemExit("APK Builder update feature must be injected first")

text = wizard.read_text()

def replace_once(old: str, new: str, label: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f"{label} insertion point not found")
    text = text.replace(old, new, 1)

replace_once(
    "    var showUpdateExisting by remember { mutableStateOf(false) }\n",
    "    var showUpdateExisting by remember { mutableStateOf(false) }\n"
    "    var updateExistingSelected by remember { mutableStateOf(false) }\n",
    "update selection state",
)

replace_once(
    "    val sourceReady = when (source) {\n",
    "    val sourceReady = updateExistingSelected || when (source) {\n",
    "source readiness",
)

replace_once(
    "                                    WizardStep.SOURCE -> {\n"
    "                                        if (source == WizardSource.WEBSITE && !WizardRules.isValidWebsite(websiteUrl)) errorMessage = ApkBuilderStrings.invalidWebsite\n"
    "                                        else { errorMessage = null; step = WizardRules.next(step) }\n"
    "                                    }",
    "                                    WizardStep.SOURCE -> {\n"
    "                                        if (updateExistingSelected) { showUpdateExisting = true }\n"
    "                                        else if (source == WizardSource.WEBSITE && !WizardRules.isValidWebsite(websiteUrl)) errorMessage = ApkBuilderStrings.invalidWebsite\n"
    "                                        else { errorMessage = null; step = WizardRules.next(step) }\n"
    "                                    }",
    "source Continue action",
)

replace_once(
    "                WizardStep.SOURCE -> SourceStep(\n"
    "                    source, websiteUrl, htmlFile, zipAnalysis, isBusy,\n"
    "                    onSource = { source = it; errorMessage = null },\n"
    "                    onWebsiteUrl = { websiteUrl = it; source = WizardSource.WEBSITE },\n"
    "                    onHtml = { htmlPicker.launch(arrayOf(\"text/html\", \"application/xhtml+xml\", \"text/plain\")) },\n"
    "                    onZip = { zipPicker.launch(arrayOf(\"application/zip\", \"application/x-zip-compressed\", \"application/octet-stream\")) },\n"
    "                    onUpdateExisting = { showUpdateExisting = true },\n"
    "                )",
    "                WizardStep.SOURCE -> SourceStep(\n"
    "                    source, websiteUrl, htmlFile, zipAnalysis, updateExistingSelected, isBusy,\n"
    "                    onSource = { updateExistingSelected = false; source = it; errorMessage = null },\n"
    "                    onWebsiteUrl = { updateExistingSelected = false; websiteUrl = it; source = WizardSource.WEBSITE },\n"
    "                    onHtml = { htmlPicker.launch(arrayOf(\"text/html\", \"application/xhtml+xml\", \"text/plain\")) },\n"
    "                    onZip = { zipPicker.launch(arrayOf(\"application/zip\", \"application/x-zip-compressed\", \"application/octet-stream\")) },\n"
    "                    onUpdateExisting = { updateExistingSelected = true; source = null; errorMessage = null },\n"
    "                )",
    "SourceStep call",
)

replace_once(
    "private fun SourceStep(\n"
    "    source: WizardSource?, websiteUrl: String, htmlFile: HtmlFile?, zipAnalysis: ZipProjectImporter.ZipProjectAnalysis?, isBusy: Boolean,\n"
    "    onSource: (WizardSource) -> Unit, onWebsiteUrl: (String) -> Unit, onHtml: () -> Unit, onZip: () -> Unit,\n"
    "    onUpdateExisting: () -> Unit,\n"
    ") {",
    "private fun SourceStep(\n"
    "    source: WizardSource?, websiteUrl: String, htmlFile: HtmlFile?, zipAnalysis: ZipProjectImporter.ZipProjectAnalysis?, updateExistingSelected: Boolean, isBusy: Boolean,\n"
    "    onSource: (WizardSource) -> Unit, onWebsiteUrl: (String) -> Unit, onHtml: () -> Unit, onZip: () -> Unit,\n"
    "    onUpdateExisting: () -> Unit,\n"
    ") {",
    "SourceStep signature",
)

old_card = '''    Card(
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
'''
new_card = '''    SourceCard(
        Icons.Outlined.SystemUpdateAlt,
        "Update Existing APK",
        "Keep its icon, splash, Android setup and saved app data. Replace only the updated web ZIP.",
        updateExistingSelected,
    ) { onUpdateExisting() }
'''
replace_once(old_card, new_card, "update source card")

wizard.write_text(text)

build_text = build.read_text()
if "versionCode = 510" not in build_text or 'versionName = "5.1.0"' not in build_text:
    raise SystemExit("5.1.0 version markers not found")
build_text = build_text.replace("versionCode = 510", "versionCode = 511", 1)
build_text = build_text.replace('versionName = "5.1.0"', 'versionName = "5.1.1"', 1)
build.write_text(build_text)

print("update source selection flow fixed")
