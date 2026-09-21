#!/usr/bin/env python3
"""Targeted HTML-app chrome and built APK save fixes for pinned conversion engine."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]

def replace_once(path, old, new):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one anchor in {path}, found {count}: {old[:100]}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')

preview = root / 'app/src/main/java/com/webtoapp/ui/webview/WebViewActivity.kt'
replace_once(
    preview,
    '    val shouldShowTopBar = showToolbarInPreview && (!hideBrowserToolbar || showSlimToolbar)',
    '    val shouldShowTopBar = showToolbarInPreview && (!hideBrowserToolbar || showSlimToolbar) && webApp?.appType != com.webtoapp.data.model.AppType.HTML',
)

build = root / 'app/src/main/java/com/webtoapp/ui/screens/BuildApkScreen.kt'
replace_once(
    build,
    '        return webApp.copy(\n            apkExportConfig =',
    '        return webApp.copy(\n            webViewConfig = if (webApp.appType == AppType.HTML) webApp.webViewConfig.copy(\n                hideBrowserToolbar = true,\n                hideToolbar = true,\n                showToolbarInFullscreen = false,\n            ) else webApp.webViewConfig,\n            apkExportConfig =',
)

replace_once(
    build,
    'import androidx.compose.runtime.Composable\n',
    'import androidx.compose.runtime.Composable\nimport androidx.activity.compose.rememberLauncherForActivityResult\nimport androidx.activity.result.contract.ActivityResultContracts\n',
)
replace_once(
    build,
    '    val scope = rememberCoroutineScope()\n\n    // 双阶段渲染',
    '''    val scope = rememberCoroutineScope()
    var apkToSave by remember(webApp.id) { mutableStateOf<java.io.File?>(null) }
    val saveApkLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/vnd.android.package-archive")
    ) { destination ->
        val source = apkToSave
        apkToSave = null
        if (destination != null && source != null) {
            scope.launch {
                val saved = withContext(Dispatchers.IO) {
                    runCatching {
                        require(source.isFile && source.length() > 0) { "APK is missing" }
                        val output = context.contentResolver.openOutputStream(destination)
                            ?: error("Cannot open selected destination")
                        output.use { stream -> source.inputStream().use { it.copyTo(stream) } }
                    }.isSuccess
                }
                android.widget.Toast.makeText(
                    context,
                    if (saved) "APK saved" else "Could not save APK",
                    android.widget.Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    // 双阶段渲染''',
)
replace_once(
    build,
    '''                    BuildSummaryCard(
                        webApp = webApp,
                        apkFile = report.apkFile,
                        totalSizeFormatted = report.totalSizeFormatted,
                        versionName = currentBuildConfig().apkExportConfig
                            ?.customVersionName?.takeIf { it.isNotBlank() } ?: "1.0.0",
                        versionCode = currentBuildConfig().apkExportConfig?.customVersionCode ?: 1,
                        buildMode = lastBuildMode,
                        buildReason = lastBuildReason
                    )

                    TextButton(''',
    '''                    BuildSummaryCard(
                        webApp = webApp,
                        apkFile = report.apkFile,
                        totalSizeFormatted = report.totalSizeFormatted,
                        versionName = currentBuildConfig().apkExportConfig
                            ?.customVersionName?.takeIf { it.isNotBlank() } ?: "1.0.0",
                        versionCode = currentBuildConfig().apkExportConfig?.customVersionCode ?: 1,
                        buildMode = lastBuildMode,
                        buildReason = lastBuildReason
                    )

                    PremiumOutlinedButton(
                        onClick = {
                            apkToSave = report.apkFile
                            saveApkLauncher.launch("${webApp.name.replace(Regex("[^A-Za-z0-9._-]"), "_")}.apk")
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Outlined.GetApp, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Save APK")
                    }

                    TextButton(''',
)
print('HTML preview/export toolbar disabled and Save APK document picker restored')
