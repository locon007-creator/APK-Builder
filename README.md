# APK Builder

This repository publishes a working on-device HTML/web-project to Android APK converter named **APK Builder**.

## Direct download

https://github.com/locon007-creator/APK-Builder/releases/latest/download/APK-Builder.apk

## APK Builder 3.1 wizard

The app now guides the complete build from start to finish:

1. Choose an HTML file, ZIP project, or website URL.
2. Enter the app name.
3. Upload an icon or generate one locally on the phone.
4. Generate a splash screen from the selected icon or upload a custom splash.
5. Review a final confirmation screen.
6. Confirm and automatically start the existing APK build process.

Icon and splash generation does not require a paid API key. The selected files and generated artwork are handed to the existing on-device converter and signing pipeline.

## Conversion engine

The original 11 KB release was only an instruction screen and did not convert files. It has been replaced by the public-domain [WebToApp](https://github.com/shiaho777/web-to-app) conversion engine, which performs APK template patching and V1/V2/V3 signing directly on Android without a PC or remote build server.

The release workflow pins the conversion source at commit `8870ee293dbb89f5293c49c3f25e767f3a996e1c`, applies the APK Builder overlay, runs the converter tests and config-drift checks, builds an installable APK, and verifies its signature before publishing. The upstream project is released under The Unlicense; see its repository for source and licensing.
