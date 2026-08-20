# APK Builder Clean Architecture

## Goal
Build APKs directly on Android from HTML or ZIP web projects, while optionally adding real Android capabilities.

## Core modules

1. **Project Importer** — accepts a single HTML file or ZIP project and validates the entry point.
2. **Project Analyzer** — detects likely native needs from the project and recommends permissions without enabling them automatically.
3. **App Configurator** — app name, package name, version, icon, splash and orientation.
4. **Native Capability Layer** — notifications/reminders, background work, location, camera, microphone, Bluetooth, file/media access and vibration.
5. **Template Engine** — starts from a known-good Android shell and injects assets/configuration/native bridge code.
6. **APK Packager** — packages, aligns and signs the APK on-device.
7. **Verifier** — checks that the output APK opens as a valid Android package and contains the requested capabilities.
8. **Build UI** — progress stages, readable errors, retry only when the user explicitly presses retry, and final APK output.

## Reliability rules

- One build request creates one build attempt.
- No automatic retries.
- No GitHub build dependency.
- Every failure stops and displays the exact failed stage.
- A capability is considered supported only after a test APK proves it works.
- Keep the Android template versioned and checksum-verified before each build.
