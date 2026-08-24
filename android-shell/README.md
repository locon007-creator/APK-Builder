# Android SDK Web Shell

This folder is the source Android project used to produce the reusable APK Builder web shell.

## Toolchain baseline

- Android Gradle Plugin: 9.3.0
- Gradle: 9.5.0
- JDK: 17
- compileSdk: 36
- targetSdk: 36
- minSdk: 26
- Android SDK Build Tools: 36.0.0

The project intentionally uses only platform Android APIs. There is no AndroidX runtime dependency in the shell.

## Security model

Packaged web content is designed to load from `https://app.local/` through `WebViewClient.shouldInterceptRequest`. The shell does not use `file://` access and does not expose a JavaScript bridge. External navigation opens outside the trusted local app context.

Only the normal `INTERNET` permission is present in this milestone. Dangerous permissions and native bridges must be added only through approved capability work.

## Developer build

Install Android SDK Platform 36, Build Tools 36.0.0, JDK 17, and Gradle 9.5.0 (or generate a Gradle Wrapper using 9.5.0).

From the repository root:

```bash
python tools/package_web.py /path/to/app.zip \
  --name "My App" \
  --id com.example.myapp
```

For a self-contained HTML file:

```bash
python tools/package_web.py /path/to/index.html \
  --name "My App" \
  --id com.example.myapp
```

The importer stages project files under `.work/`, then Gradle is configured to build against that isolated asset directory. The tracked placeholder under `app/src/main/assets/www/` stays unchanged.

The command is configured to create a debug-signed installable APK in `dist/`. The HTML/ZIP importer tests pass locally, but the Android shell still requires an Android SDK compile/install verification before the APK path is considered verified. Release signing is intentionally deferred until the signing-key workflow is implemented and verified.
