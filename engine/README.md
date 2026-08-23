# APK Builder Engine

Pure-Java Template Engine V1 core. It verifies the bundled shell contract/checksum, creates an isolated staging copy, injects one HTML entry point, preserves/aligned STORED APK entries (4-byte; 16 KiB for `.so`), applies APK/JAR v1 signing, verifies signature coverage in-process, and records compact build evidence.

Run `engine/run-tests.sh` from the repository root. The test harness uses only Java 17 plus the JDK `keytool`/`jarsigner` commands and does not require Android SDK tooling.

This is the first executable slice only. It does not make the Android app UI or real-device acceptance scenarios complete.
