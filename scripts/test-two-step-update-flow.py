#!/usr/bin/env python3
from pathlib import Path
import subprocess
import tempfile

FIXER = Path(__file__).with_name("apply-two-step-update-flow.py")

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    dialog = root / "app/src/main/java/com/webtoapp/ui/wizard/UpdateExistingApkDialog.kt"
    dialog.parent.mkdir(parents=True)
    dialog.write_text("package com.webtoapp.ui.wizard\n// legacy update dialog\n")
    build = root / "app/build.gradle.kts"
    build.write_text('versionCode = 511\nversionName = "5.1.1"\n')

    subprocess.run(["python3", str(FIXER), str(root)], check=True)

    out = dialog.read_text()
    build_out = build.read_text()

    assert 'Text("Step 1 of 2")' in out
    assert 'Text("Choose the APK you want to upgrade")' in out
    assert 'Text("Step 2 of 2")' in out
    assert 'Text("Choose the ZIP with your updated app")' in out
    assert "existingInfo != null" in out
    assert "ProjectArchive.prepare" in out
    assert "ZipProjectImporter.importZip" not in out
    assert "ExistingApkWebUpdater.prepareUnsigned" in out
    assert "enabled = !busy && existingInfo != null && project != null" in out
    assert "versionCode = 520" in build_out
    assert 'versionName = "5.2.0"' in build_out

print("TWO_STEP_UPDATE_FLOW_TEST_PASS")
