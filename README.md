# APK Builder

This repository publishes a working on-device HTML/web-project to Android APK converter.

## Direct download

https://github.com/locon007-creator/APK-Builder/releases/latest/download/APK-Builder.apk

## What was corrected

The original 11 KB release was only an instruction screen and did not convert files. It has been replaced by the public-domain [WebToApp](https://github.com/shiaho777/web-to-app) conversion engine, which performs APK template patching and V1/V2/V3 signing directly on Android without a PC or remote build server.

The release workflow pins version 2.4.3 and verifies its published SHA-256 checksum before publishing. The upstream project is released under The Unlicense; see its repository for source and licensing.
