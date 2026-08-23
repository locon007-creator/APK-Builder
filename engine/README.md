# APK Builder Engine

Pure-Java Template Engine V1 core. It verifies the bundled shell contract/checksum, creates an isolated staging copy, injects a single HTML app at `assets/html/index.html`, replaces `assets/app_config.json` with a minimal HTML-runtime configuration, preserves/aligned STORED APK entries (4-byte; 16 KiB for `.so`), applies APK/JAR v1 signing, verifies signature coverage in-process, and records compact build evidence.

The first-slice shell configuration follows the pinned WebToApp shell contract: `appType=HTML`, `siteAssetBase=html`, `htmlConfig.entryFile=index.html`. Privileged native bridge access is disabled by default.

Run `engine/run-tests.sh` from the repository root. The test harness uses Java 17 plus the JDK `keytool`/`jarsigner` commands and covers contract failures, checksum/corruption/version failures, immutable staging, HTML/config injection, STORED-entry and 16 KiB `.so` alignment, v1 signing, long Unicode entry names, signature tamper detection, and the complete local engine orchestration path.

This remains the first executable engine slice only. The test fixture is a structurally valid APK ZIP, not a compiled/installable Android shell. The Android app UI, real shell binary, official `zipalign`/`apksigner` verification, package/resource patching, and real-device acceptance scenarios are not complete yet.
