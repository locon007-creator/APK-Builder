# StopScore Android shell

Native Android wrapper for [StopScore Driver OS](https://github.com/locon007-creator/StopScore),
the calm daily operating system for truck drivers.

The workday, equipment, route, stop, and finish-day logic all live in the deployed StopScore
web application. This module is only the Android delivery surface for it, so nothing here
duplicates or reimplements driver workflow rules.

## What the shell provides

- Full-screen WebView of `https://stopscore-driver-os.locon007.chatgpt.site/`
- Persistent cookies, so a driver signs in once and stays signed in between shifts
- Launch screen using the StopScore logo lockup, cleared as soon as the first page renders
- Recoverable offline state with a Try again action, separating "no connection" from
  "server unreachable" so a driver knows which one to wait out
- Hardware back button walks the app's own history before it exits
- File picker support for uploads
- Edge-to-edge inset handling for Android 15
- External schemes (`tel:`, `mailto:`) open in their own apps; all `http(s)` navigation,
  including sign-in redirects, stays inside the shell

No location permission is declared and geolocation is disabled in the WebView: StopScore
does not use GPS.

## Icon assets

The launcher icon and launch screen are generated from `public/assets/stopscore-logo-transparent.png`
in the StopScore repository, so the Android surface carries the same mark as the web app:

- `mipmap-anydpi-v26/ic_app.xml` — adaptive icon, gauge-and-truck badge on `#050505`,
  sized inside the 66dp safe zone so no launcher mask clips it
- `mipmap-*/ic_app.png` — legacy square icons for launchers that skip adaptive icons
- `drawable-nodpi/splash_logo.png` — full lockup including the wordmark

Regenerate these from the source logo if the brand mark changes; they are not hand-drawn.

## Build

CI builds this on every push via `.github/workflows/stopscore.yml` and uploads the
`StopScore-APK` artifact. Locally:

```
cd Stopscore
gradle assembleRelease
```

The release build is signed with the debug key so the artifact is directly installable for
driver testing. Replace `signingConfig` in `app/build.gradle.kts` with a release keystore
before any public distribution.
