# APK Builder Wizard Implementation Plan

> **For agentic workers:** Execute inline with test-first changes and verify the final APK artifact.

**Goal:** Complete the approved APK Builder wizard and hand the confirmed project to the existing on-device APK build screen.

**Architecture:** Extend the existing overlay with one host-only Compose wizard and small creation callbacks that return the new app ID. Reuse the pinned converter's import, storage, repository, build, and signing paths.

**Tech Stack:** Kotlin, Jetpack Compose, Android storage APIs, JUnit, Gradle, GitHub Actions.

## Global Constraints

- No names, assets, package IDs, or code from unrelated products.
- No paid API key.
- Do not replace the pinned conversion engine.
- Preserve existing projects and conversion behavior.

### Task 1: Wizard rules and local artwork

**Files:** `app/src/main/java/com/webtoapp/ui/wizard/ApkBuilderWizard.kt`, `app/src/test/java/com/webtoapp/ui/wizard/ApkBuilderWizardRulesTest.kt`

- [ ] Add failing tests for source validation, step progression, initials, and palette selection.
- [ ] Run the focused unit test and confirm it fails for the missing rules.
- [ ] Add the minimum rules and local bitmap artwork generation.
- [ ] Re-run the focused test.

### Task 2: Wizard UI and source import

**Files:** `app/src/main/java/com/webtoapp/ui/wizard/ApkBuilderWizard.kt`

- [ ] Add HTML, ZIP, icon, and splash document pickers.
- [ ] Add source, identity, splash, confirmation, and creating states.
- [ ] Reuse `ZipProjectImporter`, `HtmlStorage`, `IconStorage`, and `SplashStorage`.
- [ ] Keep draft state when navigating backward.

### Task 3: Creation and build handoff

**Files:** `app/src/main/java/com/webtoapp/ui/viewmodel/MainViewModel.kt`, `app/src/main/java/com/webtoapp/ui/navigation/AppNavigation.kt`

- [ ] Extend existing creation methods with an optional app-ID callback.
- [ ] Apply selected splash configuration during project creation.
- [ ] Route a successful confirmation to `Routes.buildApk(appId)`.

### Task 4: Overlay and release

**Files:** `overlay/apk-builder.patch`, `.github/workflows/build-apk-builder.yml`, `README.md`

- [ ] Regenerate the overlay from the pinned upstream commit.
- [ ] Increment the APK Builder version and release metadata.
- [ ] Document the completed wizard and local artwork behavior.

### Task 5: Verification

- [ ] Verify `git apply --check` against the pinned upstream commit.
- [ ] Run the wizard unit tests and config-field drift task.
- [ ] Assemble the APK Builder debug APK.
- [ ] Verify the APK signature and archive structure.
