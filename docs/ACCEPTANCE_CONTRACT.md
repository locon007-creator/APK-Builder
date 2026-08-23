# APK Builder — Acceptance Contract

This contract defines the minimum evidence required before APK Builder or a generated APK can be called working, ready, complete, or verified.

## Scenario 1 — First use with a single HTML file

**Given** a valid HTML file with an obvious entry point,
**when** the user imports it, configures app identity, approves any recommended capabilities, and builds,
**then** the builder must create a signed APK without downloading a build template, and the output must pass structural, alignment, signature, package, and permission verification.

## Scenario 2 — ZIP project import

**Given** a valid ZIP web project,
**when** it is imported,
**then** the builder must reject path traversal, identify a deterministic entry point, preserve relative assets, and build an APK whose packaged project opens from that entry point.

## Scenario 3 — Invalid project recovery

**Given** an HTML/ZIP input with no valid entry point or a corrupt archive,
**when** import validation fails,
**then** the build must stop before template mutation and show a stable error code plus a clear recovery action. No automatic retry is allowed.

## Scenario 4 — Embedded template integrity

**Given** a missing, corrupt, incompatible, or checksum-mismatched embedded template,
**when** a build starts,
**then** the builder must stop at template verification, state the exact reason, and never silently fetch or substitute a remote template.

## Scenario 5 — Smart Permission Engine

**Given** a project that appears to need a native capability,
**when** analysis completes,
**then** the capability may be recommended but is not enabled until the user approves it. The generated manifest must contain the approved requirements and must not contain unrelated dangerous permissions.

## Scenario 6 — Native bridge trust boundary

**Given** a generated app with an approved native bridge,
**when** privileged packaged content is active,
**then** the bridge may serve only the approved capability. If navigation reaches untrusted/external content, privileged bridge access must not remain exposed to that content.

## Scenario 7 — Signing and mutation order

**Given** a staged APK ready for finalization,
**when** alignment and signing execute,
**then** all APK mutations must finish before signing, alignment must occur before `apksigner` signing, and the final APK must pass signature verification without any post-sign mutation.

## Scenario 8 — Build interruption and retry

**Given** a build that fails or is cancelled,
**when** the user returns to the build screen,
**then** the failure stage, error code, and build log remain readable. Retry occurs only after an explicit user action and creates a new isolated build attempt.

## Scenario 9 — Output evidence

**Given** a successful build,
**when** the final APK is presented,
**then** the builder must record builder version, template version/hash, input hash, package/version, enabled capabilities, manifest permissions, signer certificate digest, output hash, alignment result, and signature verification result.

## Scenario 10 — Real-device proof

**Given** a capability is labeled supported,
**when** the feature is exercised on a generated APK,
**then** there must be real-device evidence that the app launches and the capability performs its intended job. Packaging success alone is not enough.

## Cross-cutting checks

Every relevant release must also verify:

- no network dependency is required to obtain the shell template during a build;
- no GitHub Action or cloud compiler is required by the finished builder;
- build attempts use isolated working directories;
- build progress reports the real active stage;
- error states do not destroy the selected input/configuration unless recovery requires it;
- long file names, spaces, Unicode names, and nested project folders are handled safely;
- the app remains usable at narrow phone widths without tiny required text;
- all required UI text is at least 13px equivalent, inputs/controls target 16px equivalent, and contrast/readability are inspected;
- the persistent app shell does not jump or reset while build progress updates;
- progress updates change the smallest necessary UI surface rather than rebuilding the whole screen;
- reduced-motion behavior is available for nonessential animation;
- final install/share actions remain disabled until verification has succeeded.

## Completion language

Allowed only with fresh evidence:

- **Build created** — packaging produced an APK file.
- **Output verified** — structural, alignment, signature, package, and permission checks passed.
- **Capability verified** — that capability passed on-device in a generated APK.
- **Ready for use** — all applicable acceptance scenarios and device tests passed.

Do not use “fully tested,” “production ready,” or equivalent language when only packaging or static checks have run.
