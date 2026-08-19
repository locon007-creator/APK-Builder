# APK Builder 4.0 Native Capabilities Design

## Goal
Upgrade the existing APK Builder 3.1.1 wizard and conversion engine so an HTML/ZIP app can opt into real Android capabilities without rebuilding the converter or requiring the user to write Kotlin.

## Product flow
Source → App Name → Icon → Splash → Native Features → Review → Build APK.

The Native Features step is opt-in and shows only understandable capabilities, not raw Android permission names.

Initial capabilities:
- Notifications
- Scheduled reminders
- Background work
- Location / GPS
- Camera
- Microphone
- Bluetooth
- Files / storage
- Vibration / sound

## Native mapping
Each selected capability maps to the minimum Android manifest/runtime permissions and native support required by the pinned WebToApp conversion engine. Runtime permissions are requested only when the feature is actually used; APK Builder never attempts to silently grant dangerous permissions.

## HTML ↔ Android bridge
Packaged HTML/ZIP apps get a namespaced bridge exposed as `window.APKBuilderNative` with a small, versioned API. Initial bridge methods should cover notification, reminder scheduling, vibration, location, camera, and Bluetooth where the underlying shell supports them.

The bridge returns explicit success/error data so HTML apps can degrade gracefully when a feature is unavailable or permission is denied.

## Remote-site security
APK Builder also supports website URL wrappers. Privileged JavaScript bridge methods must not be exposed blindly to arbitrary remote content. Version 4.0 enables the privileged bridge by default only for packaged local HTML/ZIP sources. Remote URL builds keep privileged bridge access disabled unless an explicit trusted-origin mechanism is added later.

## Compatibility
Existing projects that select no native features must continue to build exactly as before. Existing converter template patching, signing, icon/splash handling, and source import behavior stay intact.

## Dashboard / review behavior
The final review screen lists the selected native features so the user can see exactly what the generated APK will be able to request/use.

## Verification
Before release:
1. Unit-test wizard navigation and saved capability selections.
2. Unit-test feature-to-permission/config mapping.
3. Verify no-feature builds remain backward compatible.
4. Build the APK Builder app.
5. Verify the embedded WebView shell template exists and is valid.
6. Verify APK signature.
7. Exercise a generated sample app with at least notifications/reminders and one runtime-permission feature.

## Non-goals for 4.0
- No hidden permission grants.
- No unrestricted bridge on arbitrary remote websites.
- No rewrite of the existing converter/signing engine.
- No promise of Android capabilities that are not actually wired into the generated shell.