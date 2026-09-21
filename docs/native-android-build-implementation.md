# Native Android Build mode — implementation specification

Status: DESIGN ONLY. Not implemented, tested, or included in the 4.0.2 APK.

## User outcome
Add a separate Native Android project mode to APK Builder on Android. Preserve the existing working HTML/ZIP/URL converter, name handling, gesture fixes, hidden HTML browser controls, and Save APK functionality without changing their behavior. The user should import a native project, compile locally on the phone without GitHub or a remote service, sign it, and save the generated APK.

## Compatibility reality and scope
The current on-device converter patches an embedded WebView shell APK and signs it; it does not compile arbitrary Kotlin/Java Android projects. Merely adding an SDK menu, Gradle button, or downloading Google's desktop SDK is not a native build engine. Android ARM64 compatibility must be established for the JDK, Gradle daemon, Android Gradle Plugin, AAPT2, D8/R8, ZIP alignment, and signing tools. Google's normal host binaries may not run on ARM64 Android without Android-specific distributions. Do not promise universal project support: initially accept only tested Gradle/Android Gradle Plugin combinations, Kotlin/Java Android application modules, and supported dependency types. Exclude NDK/CMake/native C++ until separately tested.

## Architecture
1. New Native Android mode entry alongside, not inside, the existing HTML mode.
2. SAF document import: pick project ZIP, validate archive and reject path traversal, absolute paths, symlinks, ZIP bombs and excessive size; extract to private app workspace. No arbitrary shell commands from imported project without explicit user consent and isolation.
3. Toolchain manager: report storage estimates and availability, download versioned compatible ARM64 Android binaries from verified distribution URLs with checksums, support cancellation, and keep toolchains private and updatable. Do not bundle desktop-only SDK binaries and claim success.
4. Project inspector: detect settings.gradle(.kts), Gradle wrapper, modules, plugins, min/target/compile SDK, and unsupported constructs before build. Show accurate unsupported-project diagnostics; never silently fall back to WebView conversion.
5. Build service: run compatible build in a foreground service/process with progress and log streaming, cancellation, resource limits and clear errors. Handle Android 16 process execution and target SDK restrictions; if not feasible in the host process use a separately documented Android-compatible execution environment, not a hidden cloud build.
6. Artifact handling: locate actual assemble output, verify APK structure and signatures, provide explicit Save APK through the system file picker; keep Share separate. Never expose success UI unless an APK exists and validation succeeds.
7. Security: untrusted Gradle scripts can execute arbitrary code. Warn before running imported project scripts; sandbox or explicitly document limitations. Do not request broad storage permission when SAF suffices. Treat signing keys securely.

## Delivery sequence and acceptance
A. Feasibility gate: on an actual supported ARM64 Android device demonstrate a command-line build of a minimal Kotlin/Java Android project using a specified JDK + Gradle + AGP + SDK toolchain, producing an installable signed APK entirely offline after setup. Record device/Android version, tool versions, checksums, storage and build time. If this fails, do not ship a simulated native mode.
B. Extract build orchestration behind a NativeBuildEngine interface; add ZIP validator, toolchain diagnostics, build log model and artifact verifier. Unit-test traversal/ZIP-bomb handling, progress, cancellation and error states.
C. Add isolated Import → Inspect → Install tools (first use) → Build → Verify → Save APK user flow. Hide or mark mode experimental until end-to-end passes.
D. Run Android unit tests, build APK Builder, verify signing, install on the user's device class, compile sample native project on device, save the output, install resulting app, and regression-test existing HTML converter, toolbar, save and swipe. Publish only then; state what remains unverified.

No APK is produced by this specification commit.