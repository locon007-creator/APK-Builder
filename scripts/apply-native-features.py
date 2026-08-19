#!/usr/bin/env python3
"""Apply APK Builder 4.0 native-capability wiring after apk-builder.patch.

This intentionally layers on top of the proven 3.1.1 overlay. It fails fast if
expected anchors drift, so upstream changes cannot silently produce a half-wired APK.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one anchor in {path}: found {count}\n{old[:160]}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


wizard = ROOT / "app/src/main/java/com/webtoapp/ui/wizard/ApkBuilderWizard.kt"
view_model = ROOT / "app/src/main/java/com/webtoapp/ui/viewmodel/MainViewModel.kt"
build_gradle = ROOT / "app/build.gradle.kts"
wizard_test = ROOT / "app/src/test/java/com/webtoapp/ui/wizard/ApkBuilderWizardRulesTest.kt"

replace_once(
    build_gradle,
    'versionCode = 311\n        versionName = "3.1.1"',
    'versionCode = 400\n        versionName = "4.0.0"',
)

replace_once(
    wizard,
    'enum class WizardStep { SOURCE, IDENTITY, SPLASH, CONFIRM, CREATING }',
    '''enum class WizardStep { SOURCE, IDENTITY, SPLASH, NATIVE_FEATURES, CONFIRM, CREATING }\n\ndata class NativeFeatureSelection(\n    val notifications: Boolean = false,\n    val reminders: Boolean = false,\n    val background: Boolean = false,\n    val location: Boolean = false,\n    val camera: Boolean = false,\n    val microphone: Boolean = false,\n    val bluetooth: Boolean = false,\n    val files: Boolean = false,\n    val vibration: Boolean = false,\n) {\n    fun runtimePermissions(): ApkRuntimePermissions = ApkRuntimePermissions(\n        camera = camera,\n        microphone = microphone,\n        location = location,\n        notifications = notifications || reminders || background,\n        readExternalStorage = files,\n        writeExternalStorage = files,\n        readMediaImages = files,\n        readMediaVideo = files,\n        readMediaAudio = files,\n        bluetooth = bluetooth,\n        foregroundService = background,\n        wakeLock = background,\n        bootCompleted = reminders || background,\n        vibration = vibration,\n    )\n\n    fun bridgeCapabilities(): NativeBridgeCapabilities = NativeBridgeCapabilities(\n        clipboard = false,\n        vibration = vibration,\n        geolocation = location,\n        brightness = false,\n        notification = notifications,\n        notificationScheduled = reminders,\n        notificationPersistent = background,\n        download = files,\n        privateNetwork = false,\n        screenWake = background,\n        openExternal = true,\n        deviceInfo = false,\n        securityInfo = false,\n        networkInfo = false,\n        toast = true,\n        logging = false,\n        findInPage = false,\n        orientation = false,\n        fullscreen = false,\n        print = false,\n    )\n\n    fun selectedCount(): Int = listOf(\n        notifications, reminders, background, location, camera, microphone, bluetooth, files, vibration\n    ).count { it }\n}''',
)

replace_once(
    wizard,
    '''        WizardStep.SPLASH -> hasIcon && hasSplash\n        WizardStep.CONFIRM -> sourceReady && appName.isNotBlank() && hasIcon && hasSplash''',
    '''        WizardStep.SPLASH -> hasIcon && hasSplash\n        WizardStep.NATIVE_FEATURES -> sourceReady && appName.isNotBlank() && hasIcon && hasSplash\n        WizardStep.CONFIRM -> sourceReady && appName.isNotBlank() && hasIcon && hasSplash''',
)
replace_once(
    wizard,
    '''        WizardStep.IDENTITY -> WizardStep.SPLASH\n        WizardStep.SPLASH -> WizardStep.CONFIRM\n        WizardStep.CONFIRM, WizardStep.CREATING -> WizardStep.CREATING''',
    '''        WizardStep.IDENTITY -> WizardStep.SPLASH\n        WizardStep.SPLASH -> WizardStep.NATIVE_FEATURES\n        WizardStep.NATIVE_FEATURES -> WizardStep.CONFIRM\n        WizardStep.CONFIRM, WizardStep.CREATING -> WizardStep.CREATING''',
)
replace_once(
    wizard,
    '''        WizardStep.SPLASH -> WizardStep.IDENTITY\n        WizardStep.CONFIRM, WizardStep.CREATING -> WizardStep.SPLASH''',
    '''        WizardStep.SPLASH -> WizardStep.IDENTITY\n        WizardStep.NATIVE_FEATURES -> WizardStep.SPLASH\n        WizardStep.CONFIRM, WizardStep.CREATING -> WizardStep.NATIVE_FEATURES''',
)

replace_once(
    wizard,
    '    var splashPath by remember { mutableStateOf<String?>(null) }\n    var errorMessage',
    '    var splashPath by remember { mutableStateOf<String?>(null) }\n    var nativeFeatures by remember { mutableStateOf(NativeFeatureSelection()) }\n    var errorMessage',
)

replace_once(
    wizard,
    '''        val completed: (Long) -> Unit = { id ->\n            isBusy = false\n            if (id > 0) onBuild(id) else {\n                step = WizardStep.CONFIRM\n                errorMessage = ApkBuilderStrings.createFailed\n            }\n        }''',
    '''        val completed: (Long) -> Unit = { id ->\n            if (id > 0) {\n                viewModel.configureNativeFeatures(\n                    appId = id,\n                    permissions = nativeFeatures.runtimePermissions(),\n                    bridgeCapabilities = nativeFeatures.bridgeCapabilities(),\n                    backgroundRunEnabled = nativeFeatures.background,\n                ) { configured ->\n                    isBusy = false\n                    if (configured) onBuild(id) else {\n                        step = WizardStep.CONFIRM\n                        errorMessage = ApkBuilderStrings.createFailed\n                    }\n                }\n            } else {\n                isBusy = false\n                step = WizardStep.CONFIRM\n                errorMessage = ApkBuilderStrings.createFailed\n            }\n        }''',
)

replace_once(
    wizard,
    '''                                    WizardStep.IDENTITY, WizardStep.SPLASH -> { errorMessage = null; step = WizardRules.next(step) }\n                                    WizardStep.CONFIRM -> createAndBuild()''',
    '''                                    WizardStep.IDENTITY, WizardStep.SPLASH, WizardStep.NATIVE_FEATURES -> { errorMessage = null; step = WizardRules.next(step) }\n                                    WizardStep.CONFIRM -> createAndBuild()''',
)
replace_once(
    wizard,
    'LinearProgressIndicator(progress = { (step.ordinal + 1).coerceAtMost(4) / 4f }, modifier = Modifier.fillMaxWidth())',
    'LinearProgressIndicator(progress = { (step.ordinal + 1).coerceAtMost(5) / 5f }, modifier = Modifier.fillMaxWidth())',
)

replace_once(
    wizard,
    '''                WizardStep.CONFIRM -> ConfirmationStep(source, websiteUrl, htmlFile, zipAnalysis, appName, iconPath, splashPath)\n                WizardStep.CREATING -> CreatingStep()''',
    '''                WizardStep.NATIVE_FEATURES -> NativeFeaturesStep(nativeFeatures) { nativeFeatures = it }\n                WizardStep.CONFIRM -> ConfirmationStep(source, websiteUrl, htmlFile, zipAnalysis, appName, iconPath, splashPath, nativeFeatures)\n                WizardStep.CREATING -> CreatingStep()''',
)

replace_once(
    wizard,
    '''private fun ConfirmationStep(\n    source: WizardSource?, websiteUrl: String, htmlFile: HtmlFile?, zipAnalysis: ZipProjectImporter.ZipProjectAnalysis?, appName: String, iconPath: String?, splashPath: String?,\n) {''',
    '''private fun ConfirmationStep(\n    source: WizardSource?, websiteUrl: String, htmlFile: HtmlFile?, zipAnalysis: ZipProjectImporter.ZipProjectAnalysis?, appName: String, iconPath: String?, splashPath: String?, nativeFeatures: NativeFeatureSelection,\n) {''',
)
replace_once(
    wizard,
    '''    SummaryCard(ApkBuilderStrings.sourceLabel, when (source) {\n        WizardSource.WEBSITE -> websiteUrl\n        WizardSource.HTML_FILE -> htmlFile?.name.orEmpty()\n        WizardSource.ZIP_PROJECT -> zipAnalysis?.zipFileName.orEmpty()\n        null -> ""\n    })''',
    '''    SummaryCard(ApkBuilderStrings.sourceLabel, when (source) {\n        WizardSource.WEBSITE -> websiteUrl\n        WizardSource.HTML_FILE -> htmlFile?.name.orEmpty()\n        WizardSource.ZIP_PROJECT -> zipAnalysis?.zipFileName.orEmpty()\n        null -> ""\n    })\n    SummaryCard("Native features", if (nativeFeatures.selectedCount() == 0) "None" else "${nativeFeatures.selectedCount()} selected")''',
)

# Insert the native-feature UI just before ConfirmationStep.
anchor = '@Composable\nprivate fun ConfirmationStep('
text = wizard.read_text(encoding="utf-8")
if text.count(anchor) != 1:
    raise SystemExit("Could not find ConfirmationStep insertion anchor")
feature_ui = r'''@Composable
private fun NativeFeaturesStep(
    features: NativeFeatureSelection,
    onChange: (NativeFeatureSelection) -> Unit,
) {
    Text("Native features", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    Text(
        "Choose only what this app needs. Android will still ask the user before sensitive permissions are granted.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    NativeFeatureToggle("Notifications", "Show Android alerts outside the web page", Icons.Outlined.Notifications, features.notifications) { onChange(features.copy(notifications = it)) }
    NativeFeatureToggle("Reminders", "Schedule reminders that can fire after the app is closed", Icons.Outlined.Alarm, features.reminders) { onChange(features.copy(reminders = it)) }
    NativeFeatureToggle("Background operation", "Allow supported work to continue in the background", Icons.Outlined.Sync, features.background) { onChange(features.copy(background = it)) }
    NativeFeatureToggle("Location / GPS", "Allow location-aware HTML and native bridge features", Icons.Outlined.LocationOn, features.location) { onChange(features.copy(location = it)) }
    NativeFeatureToggle("Camera", "Allow camera access when the HTML app requests it", Icons.Outlined.PhotoCamera, features.camera) { onChange(features.copy(camera = it)) }
    NativeFeatureToggle("Microphone", "Allow microphone access when the HTML app requests it", Icons.Outlined.Mic, features.microphone) { onChange(features.copy(microphone = it)) }
    NativeFeatureToggle("Bluetooth", "Allow supported Bluetooth discovery and connections", Icons.Outlined.Bluetooth, features.bluetooth) { onChange(features.copy(bluetooth = it)) }
    NativeFeatureToggle("Files / media", "Allow supported file and media access", Icons.Outlined.FolderOpen, features.files) { onChange(features.copy(files = it)) }
    NativeFeatureToggle("Vibration", "Allow native vibration feedback", Icons.Outlined.Vibration, features.vibration) { onChange(features.copy(vibration = it)) }
}

@Composable
private fun NativeFeatureToggle(
    title: String,
    subtitle: String,
    icon: ImageVector,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable { onCheckedChange(!checked) },
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
            Column(Modifier.padding(horizontal = 14.dp).weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(checked = checked, onCheckedChange = onCheckedChange)
        }
    }
}

'''
wizard.write_text(text.replace(anchor, feature_ui + anchor, 1), encoding="utf-8")

# Add a repository-backed configuration step that runs after project creation and before build.
vm_anchor = '    fun deleteApp(webApp: WebApp) {'
vm_text = view_model.read_text(encoding="utf-8")
if vm_text.count(vm_anchor) != 1:
    raise SystemExit("Could not find MainViewModel native config insertion anchor")
vm_method = r'''    fun configureNativeFeatures(
        appId: Long,
        permissions: ApkRuntimePermissions,
        bridgeCapabilities: NativeBridgeCapabilities,
        backgroundRunEnabled: Boolean,
        onConfigured: (Boolean) -> Unit = {},
    ) {
        viewModelScope.launch {
            try {
                val app = repository.getWebApp(appId) ?: throw IllegalStateException("Project not found")
                val export = (app.apkExportConfig ?: ApkExportConfig()).copy(
                    runtimePermissions = permissions,
                    backgroundRunEnabled = backgroundRunEnabled,
                    notificationEnabled = permissions.notifications,
                )
                val webView = app.webViewConfig.copy(
                    enableNativeBridge = true,
                    nativeBridgeCapabilities = bridgeCapabilities,
                    geolocationEnabled = permissions.location,
                    enableNotificationPolyfill = permissions.notifications,
                )
                repository.updateWebApp(app.copy(apkExportConfig = export, webViewConfig = webView))
                onConfigured(true)
            } catch (e: Exception) {
                AppLogger.e("MainViewModel", "Failed to configure native features", e)
                _uiState.value = UiState.Error(e.message ?: Strings.saveFailed)
                onConfigured(false)
            }
        }
    }

'''
view_model.write_text(vm_text.replace(vm_anchor, vm_method + vm_anchor, 1), encoding="utf-8")

# Update the pre-existing wizard tests to include the new step.
replace_once(
    wizard_test,
    'assertEquals(WizardStep.CONFIRM, WizardRules.next(WizardStep.SPLASH))\n        assertEquals(WizardStep.CREATING, WizardRules.next(WizardStep.CONFIRM))',
    'assertEquals(WizardStep.NATIVE_FEATURES, WizardRules.next(WizardStep.SPLASH))\n        assertEquals(WizardStep.CONFIRM, WizardRules.next(WizardStep.NATIVE_FEATURES))\n        assertEquals(WizardStep.CREATING, WizardRules.next(WizardStep.CONFIRM))',
)

native_test = ROOT / "app/src/test/java/com/webtoapp/ui/wizard/NativeFeatureSelectionTest.kt"
native_test.write_text('''package com.webtoapp.ui.wizard\n\nimport org.junit.Assert.assertFalse\nimport org.junit.Assert.assertTrue\nimport org.junit.Test\n\nclass NativeFeatureSelectionTest {\n    @Test\n    fun `reminders enable notification and restart support`() {\n        val permissions = NativeFeatureSelection(reminders = true).runtimePermissions()\n        assertTrue(permissions.notifications)\n        assertTrue(permissions.bootCompleted)\n        assertFalse(permissions.camera)\n    }\n\n    @Test\n    fun `background mode enables native background permissions`() {\n        val permissions = NativeFeatureSelection(background = true).runtimePermissions()\n        assertTrue(permissions.foregroundService)\n        assertTrue(permissions.wakeLock)\n        assertTrue(permissions.notifications)\n    }\n\n    @Test\n    fun `bridge exposes only selected sensitive capabilities`() {\n        val caps = NativeFeatureSelection(location = true, vibration = true).bridgeCapabilities()\n        assertTrue(caps.geolocation)\n        assertTrue(caps.vibration)\n        assertFalse(caps.notification)\n        assertFalse(caps.privateNetwork)\n        assertFalse(caps.deviceInfo)\n    }\n}\n''', encoding="utf-8")

print("APK Builder 4.0 native feature layer applied")
