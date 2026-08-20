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

GitHub is source storage only. It must not automatically build, retry, or send CI failure email traffic.
