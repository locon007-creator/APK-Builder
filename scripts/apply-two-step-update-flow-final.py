#!/usr/bin/env python3
from pathlib import Path
import subprocess
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: apply-two-step-update-flow-final.py <web-to-app-source-root>")

root = Path(sys.argv[1]).resolve()
base = Path(__file__).with_name("apply-two-step-update-flow.py")
subprocess.run(["python3", str(base), str(root)], check=True)

dialog = root / "app/src/main/java/com/webtoapp/ui/wizard/UpdateExistingApkDialog.kt"
text = dialog.read_text()
text = text.replace('\\"', '"')
dialog.write_text(text)

print("two-step update source normalized")
