# APK Builder

This repository publishes a working on-device HTML/web-project to Android APK converter named **APK Builder**.

## Direct download

https://github.com/locon007-creator/APK-Builder/releases/latest/download/APK-Builder.apk

## APK Builder 4.0 wizard

APK Builder keeps the proven on-device converter and adds a simple native-capability step to the guided build:

1. Choose an HTML file, ZIP project, or website URL.
2. Enter the app name.
3. Upload an icon or generate one locally on the phone.
4. Generate a splash screen from the selected icon or upload a custom splash.
5. Choose the native Android features the app actually needs.
6. Review the final configuration.
7. Confirm and automatically start the APK build process.

### Native Features

The 4.0 wizard can configure:

- Android notifications
- Scheduled reminders
- Background operation
- Location / GPS
- Camera
- Microphone
- Bluetooth
- File and media access
- Vibration

Selections are wired into the converter's existing runtime-permission model and WebView NativeBridge before the APK is built. Sensitive Android permissions are still requested from the user at runtime; APK Builder does not silently grant them.

The native bridge is capability-scoped so only the selected native functions are exposed by the generated configuration. The converter already provides scheduled/persistent notification, geolocation, vibration, download and related native APIs; APK Builder 4.0 makes those capabilities available through the simple build wizard.

Icon and splash generation does not require a paid API key. The selected files, generated artwork and native configuration are handed to the existing on-device converter and signing pipeline.

## Conversion engine

The original 11 KB release was only an instruction screen and did not convert files. It has been replaced by the public-domain [WebToApp](https://github.com/shiaho777/web-to-app) conversion engine, which performs APK template patching and V1/V2/V3 signing directly on Android without a PC or remote build server.

The release workflow pins the conversion source at commit `8870ee293dbb89f5293c49c3f25e767f3a996e1c`, applies the APK Builder overlay plus the 4.0 native-feature layer, runs the converter and native-feature tests and config-drift checks, builds an installable APK, verifies that its embedded WebView shell template is present and valid, and verifies its signature before publishing. The upstream project is released under The Unlicense; see its repository for source and licensing.
