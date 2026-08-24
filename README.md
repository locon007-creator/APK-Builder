# APK Builder — Fresh Start

This repository has been reset to a clean development foundation.

## Ground rules

- Local-first Android APK creation.
- No cloud compiler required by the finished app.
- No automatic GitHub Actions builds.
- No push-triggered or pull-request-triggered workflows.
- Builds are tested manually and intentionally.
- HTML and ZIP projects are converted into Android apps, not merely opened as browser links.
- Native capabilities are opt-in and added only when needed.
- Notifications, reminders, location, camera, microphone, Bluetooth, file/media access, vibration and background behavior are handled through explicit Android permissions/native bridges.
- Dangerous permissions are never blanket-enabled.

## Android SDK shell — first source milestone

The repository now includes `android-shell/`, a real Android SDK source project designed to package web content inside a native Android app shell.

Current baseline:

- Android Gradle Plugin 9.3.0;
- Gradle 9.5.0;
- JDK 17;
- Android SDK Platform / target API 36;
- Android Build Tools 36.0.0;
- minimum Android API 26.

`tools/package_web.py` accepts a self-contained HTML file or ZIP web project, validates the import, stages it in an isolated `.work/` directory, passes app name/package/version values into Gradle, and is configured to build a debug-signed APK into `dist/` when the required local Android toolchain is installed.

Example:

```bash
python tools/package_web.py app.zip --name "My App" --id com.example.myapp
```

The generated shell is designed to load packaged content from a private HTTPS-style `https://app.local/` origin. It does not use permissive `file://` access and does not expose a privileged JavaScript bridge in this milestone. External navigation leaves the trusted local content context.

The HTML/ZIP importer has local unit coverage, but an Android SDK compile/install test is still required before this milestone can be called a verified APK build path.

Release signing, icon/splash replacement, the permission engine, capability injection, and the final on-device builder UI remain later milestones and must follow the acceptance contract.

## Build order

1. Clean Android shell/template.
2. Import HTML and ZIP projects.
3. App identity: name, package name, version, icon, splash.
4. Smart Permission Engine.
5. Native capability Layer.
6. On-device APK packaging and signing.
7. Verification screen with build progress, errors and final APK output.

## Current implementation gate

Do not build later workflow/UI layers until the local template path is dependable.

The first implementation milestone is the Template Engine V1 contract in `docs/TEMPLATE_ENGINE_V1.md`:

- bundle the known-good shell inside APK Builder;
- verify its version, SHA-256 and APK structure before every build;
- copy it into isolated app-private staging;
- never download or silently substitute a template during a build;
- align before signing and verify the finished APK;
- keep privileged native bridges limited to trusted app-owned content.

The release-quality scenarios are defined in `docs/ACCEPTANCE_CONTRACT.md`. The template metadata format is defined by `docs/template-contract.schema.json`.

GitHub is source storage only. It must not automatically build, retry, or send CI failure email traffic.
