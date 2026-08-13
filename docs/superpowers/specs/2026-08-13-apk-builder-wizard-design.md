# APK Builder Wizard Design

## Goal

Finish the existing APK Builder upgrade without replacing the pinned on-device conversion engine.

## Protected behavior

- Keep `shiaho777/web-to-app` pinned at commit `8870ee293dbb89f5293c49c3f25e767f3a996e1c`.
- Keep its HTML/ZIP import, project persistence, APK conversion, signing, verification, and download behavior.
- Keep APK Builder naming and package identity self-contained.
- Do not add a paid or remote AI API requirement.

## Wizard

1. Choose one source: HTML file, ZIP project, or website URL.
2. Enter the app name and upload or locally generate an icon.
3. Upload a splash image or locally generate one from the selected icon.
4. Review the source, app name, icon, and splash choices.
5. Confirm creation.
6. Save the project and open the converter's existing APK build screen for the new project ID.

The wizard keeps a single in-memory draft until confirmation. File selections are copied by the existing storage/import utilities, and generated artwork is written to the engine's existing icon and splash directories.

## Validation and errors

- HTML requires a readable `.html` or `.htm` document.
- ZIP requires at least one HTML entry and uses the existing ZIP safety checks.
- Website requires a valid HTTP/HTTPS address.
- App name is required before artwork and confirmation.
- Icon and splash failures stay on the current step and show an error.
- Build navigation occurs only after repository creation returns a positive app ID.

## Acceptance checks

- All three source types reach the app-name step.
- Uploaded and generated icons can be selected.
- Splash generation uses the selected icon; custom splash upload remains available.
- Back navigation preserves the current draft.
- Confirmation displays the selected source, app name, icon, and splash.
- Confirm creates exactly one project and opens the existing APK build screen.
- Existing converter tests, config drift checks, APK assembly, and signature verification pass.
