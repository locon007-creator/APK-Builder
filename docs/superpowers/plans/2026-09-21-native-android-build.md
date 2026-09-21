# Native Android Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build actual native Kotlin/Java Android projects entirely on an ARM64 Android phone and save verified signed APKs, without changing the working HTML converter.

**Architecture:** Gate implementation on a reproducible real-device ARM64 build; then introduce isolated import, inspection, toolchain management, build orchestration, and artifact verification. Existing HTML/ZIP/URL conversion remains separate and unchanged.

**Tech Stack:** Kotlin, Android Storage Access Framework, foreground service, ARM64-compatible JDK/Gradle/AGP/Android build tools, Android test framework and GitHub Actions for host-app CI only.

**Spec:** `docs/native-android-build-implementation.md`

## Global Constraints

- No hidden cloud builds or GitHub per-project conversion.
- Do not treat template APK patching as native compilation.
- Preserve existing HTML converter, app names, horizontal gestures, toolbar hiding, Save APK and Share.
- Native ZIP imports must reject traversal, symlinks and decompression bombs.
- Never execute imported Gradle scripts without an explicit security warning and consent.
- NDK/CMake and unsupported AGP versions remain out of initial scope.
- No shipping or success UI without an on-device native build and a verifiable signed output.

## Review Focus

- Malicious ZIP entries cannot overwrite files outside private workspace (Task 2).
- Overlarge or compressed-bomb ZIPs are rejected before extraction (Task 2).
- Missing/incompatible ARM64 build binaries yield diagnostics, not simulated success (Tasks 1, 3).
- Cancellation stops a running build and cannot expose partial APK as success (Task 4).
- APK with missing/invalid signature cannot be saved as a successful artifact (Task 5).

---

### Task 1: Prove real Android ARM64 compilation

**Files:** Create `docs/native-build-toolchain-validation.md`; add a minimal sample native app under `native-fixtures/minimal-app/` only after determining supported versions.

**Interfaces:** Produces a documented supported tuple: Android version/device ABI; JDK; Gradle; AGP; compile SDK; AAPT2, D8/R8, zipalign and signing binary paths and SHA-256; disk/time figures; signed test APK.

- [ ] Record device Android version and ABI with `getprop ro.build.version.release; getprop ro.product.cpu.abi` on actual ARM64 Android test hardware.
- [ ] Establish on-device executable paths and checksums using `file`, `sha256sum` and a simple invocation of each required tool; do not substitute desktop Linux build success.
- [ ] Compile a minimal Java/Kotlin Android Activity project using the supported Gradle/AGP versions with internet disabled after toolchain setup; run the equivalent of `assembleDebug` directly on device.
- [ ] Verify generated APK signature, install it on the same device and launch its Activity. Record exact commands, output SHA and logs in the validation document.
- [ ] If any step fails, record exact failure and STOP native-build shipping. Do not proceed to user-facing build controls until this gate passes.

### Task 2: Secure ZIP import and project inspection

**Files:** Create focused Kotlin units under `app/src/main/java/com/webtoapp/core/nativebuild/` for `NativeProjectImporter.kt` and `NativeProjectInspector.kt`; tests under matching `app/src/test/java/com/webtoapp/core/nativebuild/` paths.

**Interfaces:** `NativeProjectImporter.import(uri: Uri, workspace: File): ImportResult`; `NativeProjectInspector.inspect(projectDir: File): InspectionResult`. Results distinguish supported project, unsupported project, and rejected archive.

- [ ] Write failing tests for `../escape`, `/absolute`, Windows traversal, symlink entries, duplicate entry names, too many entries, oversized decompressed total and high compression ratios.
- [ ] Run `:app:testStandardDebugUnitTest` and confirm the new security tests fail before implementation.
- [ ] Implement streaming import with canonical-path checks, limits and clean rollback on any rejection; extract only to app-private workspace through SAF.
- [ ] Write tests for missing `settings.gradle(.kts)`, invalid Gradle wrapper, unsupported AGP, unsupported NDK/CMake and valid sample project; implement inspector with explicit diagnostics.
- [ ] Run import/inspection tests and commit only when all pass.

### Task 3: Versioned toolchain diagnostics and setup

**Files:** Create `NativeToolchainManager.kt` and matching tests under `core/nativebuild`; add explicit version manifest/checksum file under app assets, sourced from successful Task 1 validation.

**Interfaces:** `check(): ToolchainStatus`; `install(onProgress, cancellation): ToolchainStatus`. No toolchain marked ready without executable validation.

- [ ] Write failing tests for missing tool, hash mismatch, interrupted download, insufficient free space and unsupported ABI.
- [ ] Implement app-private, versioned, checksummed downloads and extraction; reject executable formats incompatible with Android ARM64 and verify tool execution.
- [ ] Implement cancellation and removal of incomplete installs, and make offline-ready tools usable without network.
- [ ] Run unit tests and device toolchain diagnostics; commit only after real-device compatibility is confirmed.

### Task 4: Real native build orchestration

**Files:** Create `NativeBuildEngine.kt`, `NativeBuildService.kt` and tests under `core/nativebuild`; integrate in new native UI flow only, never HTML mode.

**Interfaces:** `NativeBuildEngine.build(project, toolchain, onEvent, cancellation): BuildResult`; states `PREPARING`, `BUILDING`, `VERIFYING`, `SUCCESS`, `FAILED`, `CANCELLED`.

- [ ] Write tests proving unsupported/missing tools refuse to start, cancellation terminates child processes, bounded log streaming captures errors and no failed run emits `SUCCESS`.
- [ ] Implement a foreground-service-backed build invocation using the exact working toolchain and environment from Task 1; obtain consent before executing Gradle build scripts.
- [ ] Test low disk space, backgrounding, device screen lock, cancellation and offline builds on ARM64 hardware.
- [ ] Commit only when a second full native fixture builds on device with repeatable output.

### Task 5: Verify, sign and save native APK

**Files:** Create `NativeApkVerifier.kt` and tests under `core/nativebuild`; wire SAF `CreateDocument` into a new native result screen while leaving HTML Save APK and Share untouched.

**Interfaces:** `verify(file: File): VerificationResult`; success requires nonempty APK, readable Android manifest and valid signature.

- [ ] Write failing tests for missing file, empty file, corrupt ZIP, no manifest, invalid signature and valid signed APK.
- [ ] Implement verification using proven on-device toolchain/library. Sign outputs through a securely maintained key, avoid logging secrets.
- [ ] Implement explicit Save APK via SAF, separate Share, and verify byte-for-byte copied output hash.
- [ ] Test saved APK install and launch on device; commit only when tests and end-to-end test pass.

### Task 6: Add isolated user workflow and regression gates

**Files:** Add native-mode UI screens under `app/src/main/java/com/webtoapp/ui/screens/`; modify APK Builder navigation/wizard through existing overlay scripts only where required; add integration tests.

**Interfaces:** `Choose mode → Import ZIP → Inspect → Install tools (first use) → Build → Verify → Save APK`; native mode is not available as a working choice until Task 1 and Tasks 2–5 pass.

- [ ] Write UI/integration tests ensuring HTML entry still uses old converter and native projects never fall back to WebView conversion.
- [ ] Connect only tested native states to the new screen, including consent, progress, cancel and actionable errors.
- [ ] Run existing `:app:testStandardDebugUnitTest :app:checkConfigFieldDrift`, assemble builder APK and verify its template and signature.
- [ ] On ARM64 Android, build and install native fixture through the actual screen; save artifact, install and launch output, then regression-test HTML swipe, app names, toolbar hiding and Save APK.
- [ ] Publish a new version only after all gates succeed; report exact automated tests, physical device tests and any remaining unsupported project types.

## Current status

Plan written. No native compilation implementation, executable ARM64 toolchain compatibility result or on-device end-to-end validation is claimed by this document. Device feasibility is the mandatory first gate.