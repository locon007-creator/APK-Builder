#!/usr/bin/env python3
"""APK Builder 5.3: clean 2-second splash + navigation bar build option."""
from pathlib import Path
import sys

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path("source").resolve()

def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one anchor in {path}: found {count}\n{old[:180]}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

model = ROOT / "app/src/main/java/com/webtoapp/data/model/WebApp.kt"
wizard = ROOT / "app/src/main/java/com/webtoapp/ui/wizard/ApkBuilderWizard.kt"
view_model = ROOT / "app/src/main/java/com/webtoapp/ui/viewmodel/MainViewModel.kt"
build_gradle = ROOT / "app/build.gradle.kts"

# New generated-app splash defaults: two seconds, no countdown, no tap-to-skip.
replace_once(model, "    val duration: Int = 3,", "    val duration: Int = 2,")
replace_once(model, "    val clickToSkip: Boolean = true,", "    val clickToSkip: Boolean = false,")
replace_once(model, "    val showCountdown: Boolean = true\n)", "    val showCountdown: Boolean = false\n)")

# Builder version.
replace_once(
    build_gradle,
    'versionCode = 520\n        versionName = "5.2.0"',
    'versionCode = 530\n        versionName = "5.3.0"',
)

# Store the per-build Android navigation-bar choice in the wizard.
replace_once(
    wizard,
    "    var nativeFeatures by remember { mutableStateOf(NativeFeatureSelection()) }\n    var errorMessage",
    "    var nativeFeatures by remember { mutableStateOf(NativeFeatureSelection()) }\n    var keepNavigationBarVisible by remember { mutableStateOf(false) }\n    var errorMessage",
)

# Pass the choice into the post-create configuration step.
replace_once(
    wizard,
    "                    backgroundRunEnabled = nativeFeatures.background,\n                ) { configured ->",
    "                    backgroundRunEnabled = nativeFeatures.background,\n                    showNavigationBarInFullscreen = keepNavigationBarVisible,\n                ) { configured ->",
)

# Wire the choice into the splash screen UI.
replace_once(
    wizard,
    "                WizardStep.SPLASH -> SplashStep(\n                    splashPath, isBusy,",
    "                WizardStep.SPLASH -> SplashStep(\n                    splashPath, isBusy, keepNavigationBarVisible,\n                    onNavigationBarVisibleChange = { keepNavigationBarVisible = it },",
)

replace_once(
    wizard,
    "private fun SplashStep(splashPath: String?, isBusy: Boolean, onUpload: () -> Unit, onGenerate: () -> Unit) {",
    """private fun SplashStep(
    splashPath: String?,
    isBusy: Boolean,
    keepNavigationBarVisible: Boolean,
    onNavigationBarVisibleChange: (Boolean) -> Unit,
    onUpload: () -> Unit,
    onGenerate: () -> Unit,
) {""",
)

replace_once(
    wizard,
    """    Button(onClick = onGenerate, enabled = !isBusy, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Outlined.AutoAwesome, null); Spacer(Modifier.size(8.dp)); Text(ApkBuilderStrings.generateSplash)
    }
}""",
    """    Button(onClick = onGenerate, enabled = !isBusy, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Outlined.AutoAwesome, null); Spacer(Modifier.size(8.dp)); Text(ApkBuilderStrings.generateSplash)
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Android navigation bar", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    if (keepNavigationBarVisible) "Always visible" else "Auto-hide in fullscreen",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(
                checked = keepNavigationBarVisible,
                onCheckedChange = onNavigationBarVisibleChange,
            )
        }
    }
}""",
)

# MainViewModel persists the choice onto the generated app before APK export.
replace_once(
    view_model,
    """        backgroundRunEnabled: Boolean,
        onConfigured: (Boolean) -> Unit = {},""",
    """        backgroundRunEnabled: Boolean,
        showNavigationBarInFullscreen: Boolean,
        onConfigured: (Boolean) -> Unit = {},""",
)

replace_once(
    view_model,
    """                val webView = app.webViewConfig.copy(
                    enableNativeBridge = true,""",
    """                val webView = app.webViewConfig.copy(
                    showNavigationBarInFullscreen = showNavigationBarInFullscreen,
                    enableNativeBridge = true,""",
)

print("APK Builder 5.3 splash/navigation upgrade applied")
