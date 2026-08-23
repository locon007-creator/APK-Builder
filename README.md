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

## Build order

1. Clean Android shell/template.
2. Import HTML and ZIP projects.
3. App identity: name, package ID, icon, splash.
4. Smart Permission Engine.
5. Native bridge/capability injection.
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
