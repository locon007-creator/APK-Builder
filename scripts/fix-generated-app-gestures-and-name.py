#!/usr/bin/env python3
"""Targeted changes applied to pinned web-to-app source after APK Builder overlays."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]

def replace_exact(path, old, new):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one matching anchor in {path}, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')

# The original generator searches for WebToApp but APK Builder's own shell
# label is APK Builder. As a result, the generated APK retains that label.
arsc = root / 'app/src/main/java/com/webtoapp/core/apkbuilder/ArscRebuilder.kt'
replace_exact(
    arsc,
    '                "WebToApp - Convert Any Website to Android App",\n                "WebToApp"',
    '                "WebToApp - Convert Any Website to Android App",\n                "WebToApp",\n                "APK Builder",\n                "APK-Builder"',
)

# Pull-to-refresh remains available for vertical drags. Only horizontal
# gestures are excluded from the refresh parent's touch interception.
refresh = root / 'app/src/main/java/com/webtoapp/ui/components/WebSwipeRefreshLayout.kt'
replace_exact(
    refresh,
    '    private var pullArmed = false\n',
    '    private var pullArmed = false\n    private var gestureStartX = 0f\n    private var gestureStartY = 0f\n    private var horizontalGesture = false\n',
)
replace_exact(
    refresh,
    '                pullArmed = ev.y >= topExclusionLowerBoundPx()\n            }\n            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> pullArmed = false\n        }\n        if (!pullArmed) return false\n',
    '                pullArmed = ev.y >= topExclusionLowerBoundPx()\n                gestureStartX = ev.x\n                gestureStartY = ev.y\n                horizontalGesture = false\n            }\n            MotionEvent.ACTION_MOVE -> {\n                val dx = kotlin.math.abs(ev.x - gestureStartX)\n                val dy = kotlin.math.abs(ev.y - gestureStartY)\n                if (dx > android.view.ViewConfiguration.get(context).scaledTouchSlop && dx > dy) {\n                    horizontalGesture = true\n                }\n            }\n            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {\n                pullArmed = false\n                horizontalGesture = false\n            }\n        }\n        if (!pullArmed || horizontalGesture) return false\n',
)
print('Applied generated-app name fix and horizontal swipe guard')
