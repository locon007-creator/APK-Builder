# APK Builder 4.0 Native Capabilities Implementation Plan

## Objective
Extend the existing APK Builder overlay on the pinned WebToApp engine. Preserve the current conversion/signing pipeline and add a tested native-capability layer.

## Task 1 — Native Features wizard step
- Add `NATIVE_FEATURES` between Splash and Confirm.
- Add a `NativeFeature` model and capability selections to `WizardDraft`.
- Add focused UI with plain-language toggles.
- Update wizard back/next behavior and progress labels.
- Add tests first for navigation, persistence, and confirmation summary.

## Task 2 — Feature configuration mapping
- Locate the pinned converter's permission/config model.
- Add a deterministic mapping from each `NativeFeature` to required converter config / Android permissions.
- Preserve empty-selection backward compatibility.
- Add unit tests for the mapping.

## Task 3 — Packaged-app native bridge
- Locate the generated WebView shell's existing JavaScript bridge hooks.
- Add a versioned `APKBuilderNative` bridge for only capabilities backed by actual native implementations.
- Return structured success/error results.
- Expose privileged bridge only to packaged local HTML/ZIP content in 4.0.
- Add tests for bridge registration/security gating where testable.

## Task 4 — Native implementations
Implement/wire the first supported feature set using Android-compliant APIs:
- notifications / notification channels
- scheduled reminders / background-safe scheduling
- vibration
- location permission + current location path
- camera intent or capture hook
- Bluetooth scan/connect hook where supported
- microphone/file hooks only if converter shell already supports a safe path

If a capability cannot be made real in the current shell, do not present it as enabled in 4.0.

## Task 5 — Review and build integration
- Show selected native features on final confirmation.
- Apply selected feature config to the generated APK template before signing.
- Ensure no-feature builds follow the existing path unchanged.

## Task 6 — Version/release workflow
- Update app-visible version to 4.0.0 only after tests pass.
- Update README and release notes.
- Update GitHub Actions workflow to apply the 4.0 patch(es), run tests/config-drift checks, build, verify embedded shell, and verify signature.

## Task 7 — Verification
- Run feature-branch CI.
- Inspect failures and fix until green.
- Verify generated APK artifact and signature.
- Keep changes isolated on `feature/apk-builder-4-native-capabilities`; do not merge to main without explicit owner approval.