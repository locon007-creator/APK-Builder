# APK Builder Clean Architecture

## Goal
Build APKs directly on Android from HTML or ZIP web projects, while optionally adding real Android capabilities. Existing APKs created by APK Builder can also receive content-only upgrades without redoing their Android identity, icon, splash, permissions, or native configuration.

## Core modules

1. **Project Importer** — accepts a single HTML file or ZIP project and validates the entry point.
2. **Project Analyzer** — detects likely native needs from the project and recommends permissions without enabling them automatically.
3. **App Configurator** — app name, package name, version, icon, splash and orientation.
4. **Native Capability Layer** — notifications/reminders, background work, location, camera, microphone, Bluetooth, file/media access and vibration.
5. **Template Engine** — starts from a known-good Android shell and injects assets/configuration/native bridge code.
6. **APK Packager** — packages, aligns and signs the APK on-device.
7. **Existing APK Update Engine** — accepts an APK plus new web content, verifies the original signer, preserves package identity/resources/native configuration, replaces only packaged web assets, increments `versionCode`, re-signs with the original key, and verifies the update APK before publication.
8. **Verifier** — checks that the output APK opens as a valid Android package and contains the requested capabilities.
9. **Build UI** — progress stages, readable errors, retry only when the user explicitly presses retry, and final APK output.

## Reliability rules

- One build request creates one build attempt.
- No automatic retries.
- No GitHub build dependency.
- Every failure stops and displays the exact failed stage.
- A capability is considered supported only after a test APK proves it works.
- Keep the Android template versioned and checksum-verified before each build.
- Existing-app updates must preserve the package name and use the same signing certificate; otherwise the update is rejected before publication.
- A content-only update must not replace the existing icon, splash, permissions, Android resources, or native configuration unless the user explicitly chooses a full rebuild instead.
