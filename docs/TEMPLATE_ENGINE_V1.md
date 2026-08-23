# APK Builder — Template Engine V1

## Purpose

Make the Android shell a dependable local build input instead of a runtime dependency. The builder must never need a network request, GitHub release, remote compiler, or automatic retry to obtain the template required for a build.

## Core decision

The known-good Android shell is bundled inside APK Builder as an immutable app asset. Every build uses a private working copy of that bundled template.

The builder must not:

- download a template during a normal build;
- silently fall back to a remote template;
- modify the bundled source template in place;
- continue when template verification fails;
- retry a failed stage automatically.

## Template package

A release contains these two matching assets:

- `template/webview_shell.apk`
- `template/template-contract.json`

The contract identifies the template version, SHA-256 digest, supported capabilities, minimum builder version, expected package skeleton, and required APK entries.

Before any project data is applied, Template Engine performs the following checks in order:

1. Contract exists and parses.
2. Embedded template exists and is non-empty.
3. SHA-256 matches the contract.
4. APK ZIP structure is valid.
5. `AndroidManifest.xml`, `resources.arsc`, and `classes.dex` exist.
6. Template version is supported by this APK Builder version.
7. The builder copies the template into app-private staging.
8. Every patch operates only on the staging copy.

A failure stops the build at the exact stage and returns one stable error code. There is no network fallback.

## Error contract

Use stable machine-readable codes plus a short human explanation:

- `TEMPLATE_CONTRACT_MISSING`
- `TEMPLATE_CONTRACT_INVALID`
- `TEMPLATE_MISSING_INTERNAL`
- `TEMPLATE_CHECKSUM_MISMATCH`
- `TEMPLATE_CORRUPT`
- `TEMPLATE_INCOMPATIBLE`
- `IMPORT_NO_ENTRY_POINT`
- `IMPORT_INVALID_ARCHIVE`
- `PATCH_MANIFEST_FAILED`
- `PATCH_RESOURCES_FAILED`
- `PATCH_ASSETS_FAILED`
- `CAPABILITY_CONFIG_FAILED`
- `ALIGN_FAILED`
- `SIGNING_FAILED`
- `SIGNATURE_VERIFY_FAILED`
- `OUTPUT_VERIFY_FAILED`

The UI should show the failed stage, the code, a plain-language explanation, and a manual Retry button only when retrying could realistically help.

## Build pipeline

### 1. Import

Accept either a single HTML document or a ZIP web project. ZIP import must validate paths, reject traversal outside the project root, enforce reasonable expanded-size and file-count limits, and identify a deterministic entry point.

### 2. Analyze

Detect likely capability needs from project behavior and metadata. Recommendations never grant Android permissions automatically.

### 3. Configure

Collect app identity and user-approved capabilities:

- app name;
- package ID;
- version name/code;
- icon and splash;
- orientation;
- approved Android permissions/native capabilities.

### 4. Stage template

Verify the immutable embedded template against `template-contract.json`, then copy it to an isolated build workspace.

### 5. Inject project

Place project files into the shell assets and write one normalized runtime configuration file. Do not scatter equivalent configuration across unrelated files.

Local content should be served through an HTTPS-style in-app origin rather than permissive `file://` access.

### 6. Apply capabilities

Native capability code is precompiled into the shell. A build enables only the approved capability configuration and required manifest permissions. Unused dangerous permissions are removed.

Native bridge exposure must be limited to trusted app-owned content. External or untrusted pages must not receive privileged JavaScript interfaces. External links should open outside the privileged local-app context unless explicitly supported by a safe allowlisted integration.

### 7. Patch identity/resources

Patch package identity, app label, icons, splash resources, orientation, manifest declarations, and version information in the staging copy.

### 8. Align

Align the unsigned output before signing. For APKs containing uncompressed native libraries, verification must account for current Android page-alignment requirements.

### 9. Sign

Sign only after all mutations are complete. A signing key must remain under user control. Never mutate a signed APK afterward.

### 10. Verify

Before presenting the output, verify at minimum:

- APK ZIP integrity;
- alignment;
- signature validity;
- package ID and version;
- requested permissions present;
- unrequested dangerous permissions absent;
- expected project entry point present;
- template version recorded;
- output SHA-256 generated.

## Native bridge security boundary

The generated app has two trust zones:

1. **Privileged local app content** — packaged project content loaded from the app-owned local origin. Approved native bridges may be available here.
2. **Untrusted/external web content** — remote pages, redirects, ads, embedded third-party frames, and arbitrary URLs. Privileged bridges must not be exposed here.

This boundary is mandatory for camera, location, file/media access, notifications, microphone, Bluetooth, or any bridge that can access device/user data.

## Build evidence record

Each successful build stores a compact evidence record containing:

- build ID;
- builder version;
- template version and template SHA-256;
- input project SHA-256;
- package ID;
- version name/code;
- enabled capabilities;
- granted manifest permissions;
- signer certificate digest;
- output APK SHA-256;
- alignment result;
- signature verification result;
- completion timestamp.

This record is evidence only. It does not replace installing and testing the APK on a real Android device.

## Locked reliability rules

- One user build action creates one build attempt.
- No automatic retry.
- No GitHub dependency during a build.
- No remote template dependency during a build.
- Every failure stops at the exact failed stage.
- The immutable embedded template is checksum-verified before use.
- A capability is not labeled supported until a generated APK proves it on-device.
- A build is not labeled complete until output verification succeeds.
