#!/usr/bin/env python3
"""Package a single HTML file or ZIP web project into the Android SDK shell."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

MAX_ZIP_FILES = 5_000
MAX_ZIP_EXPANDED_BYTES = 250 * 1024 * 1024
APP_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$")

REPO_ROOT = Path(__file__).resolve().parents[1]
SHELL_ROOT = REPO_ROOT / "android-shell"
WEB_ROOT = SHELL_ROOT / "app" / "src" / "main" / "assets" / "www"
DIST_ROOT = REPO_ROOT / "dist"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert an HTML file or ZIP web project into an installable debug APK."
    )
    parser.add_argument("source", type=Path, help="Path to a .html/.htm file or .zip project")
    parser.add_argument("--name", required=True, help="Android app display name")
    parser.add_argument("--id", required=True, dest="app_id", help="Android package ID, e.g. com.example.myapp")
    parser.add_argument("--version-name", default="1.0")
    parser.add_argument("--version-code", type=int, default=1)
    parser.add_argument(
        "--entry",
        default=None,
        help="Optional ZIP-relative entry HTML path when the archive has more than one app",
    )
    parser.add_argument("--prepare-only", action="store_true", help="Import files but do not run Gradle")
    return parser.parse_args()


def fail(message: str, code: int = 2) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(code)


def validate_identity(args: argparse.Namespace) -> None:
    if not args.name.strip():
        fail("App name cannot be empty.")
    if not APP_ID_RE.fullmatch(args.app_id):
        fail("Package ID must look like com.example.myapp and contain only letters, digits, or underscores.")
    if args.version_code < 1:
        fail("Version code must be 1 or greater.")


def is_zip_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0o170000
    return mode == 0o120000


def safe_extract_zip(source: Path, destination: Path) -> None:
    try:
        archive = zipfile.ZipFile(source)
    except (OSError, zipfile.BadZipFile) as exc:
        fail(f"IMPORT_INVALID_ARCHIVE: {exc}")

    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ZIP_FILES:
            fail(f"IMPORT_INVALID_ARCHIVE: archive has more than {MAX_ZIP_FILES} entries")

        expanded = sum(info.file_size for info in infos)
        if expanded > MAX_ZIP_EXPANDED_BYTES:
            fail("IMPORT_INVALID_ARCHIVE: expanded archive is larger than 250 MB")

        for info in infos:
            name = info.filename.replace("\\", "/")
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or is_zip_symlink(info):
                fail(f"IMPORT_INVALID_ARCHIVE: unsafe ZIP entry: {info.filename}")

        archive.extractall(destination)


def choose_entry_root(extracted: Path, requested_entry: str | None) -> Path:
    if requested_entry:
        normalized = PurePosixPath(requested_entry.replace("\\", "/"))
        if normalized.is_absolute() or ".." in normalized.parts:
            fail("IMPORT_NO_ENTRY_POINT: --entry must stay inside the ZIP project")
        entry = extracted.joinpath(*normalized.parts)
        if not entry.is_file() or entry.suffix.lower() not in {".html", ".htm"}:
            fail(f"IMPORT_NO_ENTRY_POINT: entry not found: {requested_entry}")
        return entry.parent

    candidates = sorted(
        (p for p in extracted.rglob("*") if p.is_file() and p.name.lower() in {"index.html", "index.htm"}),
        key=lambda p: (len(p.relative_to(extracted).parts), str(p.relative_to(extracted)).lower()),
    )
    if not candidates:
        fail("IMPORT_NO_ENTRY_POINT: ZIP project does not contain index.html or index.htm")
    return candidates[0].parent


def reset_web_root() -> None:
    if WEB_ROOT.exists():
        shutil.rmtree(WEB_ROOT)
    WEB_ROOT.mkdir(parents=True, exist_ok=True)


def import_project(source: Path, requested_entry: str | None) -> None:
    if not source.exists() or not source.is_file():
        fail(f"Input file does not exist: {source}")

    suffix = source.suffix.lower()
    reset_web_root()

    if suffix in {".html", ".htm"}:
        shutil.copy2(source, WEB_ROOT / "index.html")
        return

    if suffix != ".zip":
        fail("Source must be a .html, .htm, or .zip file.")

    with tempfile.TemporaryDirectory(prefix="apk-builder-import-") as temp_dir:
        extracted = Path(temp_dir) / "project"
        extracted.mkdir(parents=True)
        safe_extract_zip(source, extracted)
        project_root = choose_entry_root(extracted, requested_entry)

        for item in project_root.iterdir():
            target = WEB_ROOT / item.name
            if item.is_dir():
                shutil.copytree(item, target)
            else:
                shutil.copy2(item, target)

        index_html = WEB_ROOT / "index.html"
        index_htm = WEB_ROOT / "index.htm"
        if not index_html.exists() and index_htm.exists():
            index_htm.rename(index_html)
        if not index_html.exists():
            fail("IMPORT_NO_ENTRY_POINT: selected ZIP app root has no index.html")


def sdk_root() -> Path | None:
    raw = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    return Path(raw).expanduser() if raw else None


def check_android_sdk() -> None:
    root = sdk_root()
    if root is None:
        fail("Android SDK not found. Set ANDROID_SDK_ROOT or ANDROID_HOME.")

    required = [
        root / "platforms" / "android-36",
        root / "build-tools" / "36.0.0",
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        fail("Android SDK is missing required components: " + ", ".join(missing))


def find_gradle() -> list[str]:
    wrapper = SHELL_ROOT / ("gradlew.bat" if os.name == "nt" else "gradlew")
    wrapper_jar = SHELL_ROOT / "gradle" / "wrapper" / "gradle-wrapper.jar"
    if wrapper.exists() and wrapper_jar.exists():
        return [str(wrapper)]

    installed = shutil.which("gradle")
    if installed:
        return [installed]

    fail("Gradle was not found. Install Gradle 9.5.0 or generate the Gradle Wrapper for android-shell.")
    raise AssertionError("unreachable")


def safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", name.strip()).strip("-._")
    return cleaned or "generated-app"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_debug_apk(args: argparse.Namespace) -> Path:
    check_android_sdk()
    gradle = find_gradle()
    command = gradle + [
        ":app:assembleDebug",
        f"-PAPP_ID={args.app_id}",
        f"-PAPP_NAME={args.name}",
        f"-PVERSION_NAME={args.version_name}",
        f"-PVERSION_CODE={args.version_code}",
    ]
    print("Running Android SDK build...")
    subprocess.run(command, cwd=SHELL_ROOT, check=True)

    built = SHELL_ROOT / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
    if not built.exists():
        fail("OUTPUT_VERIFY_FAILED: Gradle finished but the expected APK was not found")

    DIST_ROOT.mkdir(parents=True, exist_ok=True)
    output = DIST_ROOT / f"{safe_filename(args.name)}-debug.apk"
    shutil.copy2(built, output)
    return output


def main() -> None:
    args = parse_args()
    validate_identity(args)
    source = args.source.expanduser().resolve()

    print(f"Importing {source.name}...")
    import_project(source, args.entry)
    print(f"Prepared web project at: {WEB_ROOT}")

    if args.prepare_only:
        print("Prepare-only complete. No APK build was started.")
        return

    output = build_debug_apk(args)
    print(f"Build created: {output}")
    print(f"SHA-256: {sha256(output)}")
    print("Note: this is a debug-signed APK. Release signing is intentionally not enabled yet.")


if __name__ == "__main__":
    main()
