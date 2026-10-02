#!/usr/bin/env python3
"""APK Builder 5.3.2: preserve authored HTML text scale in generated APKs."""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: apply-text-scale-fix.py <web-to-app-source-root>")

root = Path(sys.argv[1]).resolve()
manager = root / "app/src/main/java/com/webtoapp/core/webview/WebViewManager.kt"
if not manager.is_file():
    raise SystemExit("WebViewManager.kt not found")

text = manager.read_text()
anchor = '''            com.webtoapp.core.perf.NativePerfEngine.optimizeWebViewSettings(this)

            // Runtime per-app page zoom (textZoom), persisted across cold starts via
'''
replacement = '''            com.webtoapp.core.perf.NativePerfEngine.optimizeWebViewSettings(this)

            // Generated-app fidelity guard:
            // keep authored CSS text at Android WebView's true 100% baseline.
            // Some devices / WebView revisions can retain or re-apply a larger textZoom
            // during configuration. Pin the baseline here, after performance settings.
            settings.textZoom = 100
            AppLogger.d("WebViewManager", "Text scale fidelity baseline applied: textZoom=100%")

            // Runtime per-app page zoom (textZoom), persisted across cold starts via
'''
if anchor not in text:
    raise SystemExit("WebView text-scale insertion anchor not found")
text = text.replace(anchor, replacement, 1)
manager.write_text(text)

gradle = root / "app/build.gradle.kts"
if not gradle.is_file():
    raise SystemExit("app/build.gradle.kts not found")
g = gradle.read_text()
old_version = 'versionCode = 531\n        versionName = "5.3.1"'
new_version = 'versionCode = 532\n        versionName = "5.3.2"'
if old_version not in g:
    raise SystemExit("APK Builder 5.3.1 version anchor not found")
g = g.replace(old_version, new_version, 1)
gradle.write_text(g)

print("APK Builder 5.3.2 text-scale fidelity fix applied")
