# Template Engine V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the first executable APK Builder slice that can accept one HTML file, build a generated APK locally from a bundled verified shell, align it, sign it, and verify the final output without any runtime GitHub/cloud dependency.

**Architecture:** Keep the existing proven WebToApp conversion/signing engine as implementation raw material, pinned to the previously verified source commit, but package the shell inside APK Builder and add an explicit Template Engine V1 verification boundary before conversion. Development may fetch pinned source/dependencies while assembling APK Builder; end-user APK creation must run entirely on-device from bundled assets. The first slice intentionally excludes ZIP import, broad native capabilities, and premium UI work.

**Tech Stack:** Android/Kotlin, Gradle/AGP, Android Build Tools (`zipalign`, `apksigner`) for development verification, JSON template contract, SHA-256, existing WebToApp on-device APK patch/sign engine.

**Spec:** `docs/TEMPLATE_ENGINE_V1.md` and `docs/ACCEPTANCE_CONTRACT.md`

## Global Constraints

- Local-first end-user APK creation.
- No GitHub, cloud compiler, remote template, or automatic retry during an end-user build.
- Immutable bundled shell must be checksum-verified before every build.
- All mutations finish before signing; alignment occurs before signing.
- One user build action creates one isolated build attempt.
- No capability may be called supported without real generated-APK evidence.
- No completion claim without fresh verification evidence.

---

### Task 1: Recreate the proven converter baseline in an isolated development workspace

**Files:**
- Preserve: `docs/TEMPLATE_ENGINE_V1.md`
- Preserve: `docs/ACCEPTANCE_CONTRACT.md`
- Add implementation source under `engine/` or a pinned bootstrap path without enabling automatic CI.

**Interfaces:**
- Consumes: pinned WebToApp source commit `8870ee293dbb89f5293c49c3f25e767f3a996e1c` and the previously verified APK Builder overlay/native layer.
- Produces: a locally buildable APK Builder development tree and a reproducible command for unit/config checks plus debug APK assembly.

- [ ] Verify the pinned source identity and old build inputs match the previously verified workflow.
- [ ] Recreate the source tree in a disposable local workspace.
- [ ] Apply the prior APK Builder overlay and native layer only as baseline raw material.
- [ ] Run existing converter/unit/config tests before introducing Template Engine changes.
- [ ] Build the baseline APK Builder debug APK and verify its APK ZIP/signature structure.

### Task 2: Add Template Contract verification with TDD

**Files:**
- Create focused Template Contract model/parser/verifier source in the converter project.
- Create unit tests beside the existing test suite.
- Consume: `docs/template-contract.schema.json` semantics.

**Interfaces:**
- Produces a verifier returning a verified template descriptor or one stable error code from the Template Engine V1 contract.
- Verification order: contract parse → template exists/non-empty → SHA-256 → ZIP validity/required entries → version compatibility.

- [ ] Write a failing test for valid contract + shell verification.
- [ ] Run it and confirm failure is caused by missing verifier behavior.
- [ ] Implement only the minimum parser/verifier needed for green.
- [ ] Add failing tests for missing contract, missing shell, checksum mismatch, corrupt ZIP, missing required entry, and incompatible version.
- [ ] Implement stable error mapping and rerun the full verifier suite.

### Task 3: Wire verified immutable shell into one HTML build attempt

**Files:**
- Modify the conversion entry point to require verified bundled shell before mutation.
- Add isolated staging/build-attempt helper.
- Add one HTML fixture/test project.

**Interfaces:**
- Consumes: verified immutable bundled shell descriptor.
- Produces: a staged working copy and generated unsigned/aligned/signed APK for a single HTML input.

- [ ] Write a failing integration-level test proving the original bundled shell is never modified and a unique staging copy is used.
- [ ] Implement isolated staging.
- [ ] Write a failing test proving one HTML input reaches the generated package assets/entry point.
- [ ] Wire the existing patch/sign pipeline behind Template Engine verification.
- [ ] Verify no normal build path downloads or substitutes a template.

### Task 4: Fresh build/output verification gate

**Files:**
- Add/extend verification script or test helper for APK structure and evidence output.
- Do not add automatic GitHub Actions.

**Interfaces:**
- Produces a verified APK plus evidence: builder version, template version/hash, input hash, output hash, package/version, alignment result, signature result.

- [ ] Build APK Builder from the modified source.
- [ ] Run all existing tests plus new Template Engine tests.
- [ ] Execute the minimal HTML → generated APK path.
- [ ] Verify generated APK ZIP integrity, required entries, alignment, and signature.
- [ ] Confirm the generated app contains the expected HTML entry point and the bundled template checksum remains unchanged.
- [ ] Record exactly which Acceptance Contract scenarios are proven and which remain blocked by lack of a real Android device.

### Task 5: Integration decision

**Files:**
- Update implementation status documentation only after fresh evidence exists.

**Interfaces:**
- Produces: a tested feature branch suitable for review; `main` remains untouched until verification passes.

- [ ] Re-read `docs/TEMPLATE_ENGINE_V1.md` and `docs/ACCEPTANCE_CONTRACT.md` line-by-line against the implementation.
- [ ] Run the full verification command again from a clean state.
- [ ] If any runtime gate fails, keep the branch unmerged and report the exact blocker.
- [ ] If all non-device gates pass, open a PR with test evidence and clearly label real-device scenarios as pending until exercised on hardware.
