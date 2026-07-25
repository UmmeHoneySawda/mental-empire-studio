# OpenMontage integration — security and dependency review

Scope: the `feat/openmontage-integration` diff against `origin/build/mental-empire-studio`.
Threat model reused: `codex-security-target/v1:sha256:2fc948b191b99b6b1d09a14854e640f6c0983744570caeb8de40ead064fcd49f`
(cached at `%TEMP%\codex-security-scans\mental-empire-studio\threat_model.md`).

## Tooling honesty

The `codex-security` `security-diff-scan` skill is **not available in this environment** — it is a
Codex-side skill and is not present in this session's skill set. The prior scan directory
(`f8b25b2_20260725T002309+0600`) contains only the cached threat model plus an **empty**
`security_guidance.md`; no discovery, ledger, findings, report, or manifest was ever produced, so
nothing from it may be reported as a completed scan.

This review is therefore a **manual audit against the cached threat model's invariants**, plus a
dependency-advisory reachability analysis. It is not a substitute for the skill's full pipeline, and
the TEST_MATRIX records it as such.

## Audited invariants

| Area | Finding | Evidence |
| --- | --- | --- |
| Command injection | No shell interpretation anywhere in the integration. `grep` for `shell: true`, `exec(`, `execSync(` across `electron/services/openmontage/`, `resources/openmontage-runner/`, `shared/openmontage*.ts` returns nothing. | All launches use `execFile`/`spawn`/`spawnSync` with argument arrays. |
| Argument escaping | Arguments are passed as arrays, never concatenated into a command string. The Codex child is spawned as `spawn(codexExecutable, execArgs, …)`. | `codex-runner.mjs:832`, `assisted.ts:53`, `health.ts:70`, `index.ts:93` |
| Executable trust | The runner refuses to start unless `--openmontage-runner` is present, the protocol string matches, and both the Codex and ffprobe executables exist on disk. | `codex-runner.mjs:96-103` |
| Path traversal | Containment uses canonical `path.relative` and rejects both `..` escapes and absolute results — the correct check on Windows, including drive-relative paths. | `codex-runner.mjs:91-94`; `openmontage-managed.test.ts` "fails closed when a runner reports an output outside approved roots" |
| Imported package validation | Job packages are schema-validated before any workspace is written; traversal- and secret-bearing packages are rejected pre-write. | `openmontage-assisted.test.ts` "rejects path traversal and secret-bearing packages before writing a workspace" |
| Schema validation | `validateOpenMontageJobPackage` enforces types, contiguous timeline ordering, non-overlap, duration bounds, asset references and locked flags; runner events are strictly parsed with size limits. | `shared/openmontage.ts`, `openmontage-contracts.test.ts`, `openmontage-runner-protocol.test.ts` |
| Localhost-only interfaces | Backlot URLs must resolve to `localhost`/`127.0.0.1`/`::1` over http(s); any other host or scheme throws. Username, password, query and fragment are stripped from the normalised URL. | `backlot.ts:17-31` |
| Secret redaction | Credentials are reported as `{provider, configured, source}` with no values. The environment resolver returns names and counts only and never mutates MES `process.env`. | `environment.ts:52-56`; evidence audit below |
| Temporary credential cleanup | Provider values are resolved per launch into the child environment only; nothing is written to SQLite (no credential columns) or to event/output rows. | `openmontage-db.test.ts` "stores no credential columns"; `openmontage-managed.test.ts` "passes repository environment values to the managed runner without persisting them" |
| Process-control hardening | `PATH`, `PATHEXT`, `COMSPEC`, `NODE_OPTIONS`, `NODE_PATH`, `ELECTRON_RUN_AS_NODE`, `LD_LIBRARY_PATH`, `LD_PRELOAD`, `PYTHON*` and every `DYLD_*` key are refused from the repository `.env`; OS values take precedence. | `environment.ts:10-44`, `openmontage-environment.test.ts` |
| Safe cancellation / termination | Windows termination uses `taskkill /PID <pid> /T /F` for whole-tree cleanup; POSIX kills the process group with a single-process fallback. Verified against a real parent+descendant process. | `codex-runner.mjs:664`; `openmontage-process-tree.test.ts` |
| Telemetry sanitization | Sentry receives a category, code, stage and a redacted message; the telemetry string is rebuilt as `"<CODE>: managed runner failed during <stage> stage."` rather than forwarding raw stderr. | `managed.ts:472-480`, `openmontage-contracts.test.ts` redaction cases |

### Committed-evidence audit

The committed acceptance evidence was scanned directly. `health.credentials` contains only
`{provider, configured, source}`; `health.environment` contains only `filePath`, `status`,
`loadedVariableCount` and `blockedVariableNames`. The strings `PEXELS_API_KEY`, `OPENAI_API_KEY`,
`access_token`, `refresh_token`, `id_token`, `Bearer ` and `sk-` are all **absent** from
`evidence/A-B-D-F-G/acceptance.json`.

### Repository secret scan

398 tracked text files were scanned for OpenAI/GitHub/AWS/Google/Slack key shapes, private-key
headers, JWTs, bearer tokens and assigned-secret patterns. **7 candidates, all intentionally fake
fixture values** whose entire purpose is to prove redaction works — `groq-test-key`,
`child-only-value`, `file-only-value`, `os-secret-value`, `secret-value`,
`must-never-cross-the-boundary`. No real credential is committed.

## Dependency advisories

### The "Remotion advisory" is not a Mental Empire Studio dependency

Remotion is **absent from MES entirely**: it appears in neither `dependencies` nor
`devDependencies`, and `node_modules/remotion` and `node_modules/@remotion` do not exist. It is the
external engine's local render tooling, installed at
`D:\Work\OpenMontage\remotion-composer`.

`npm audit` there reports exactly **2 high, 0 critical**, both transitive and both build-time only:

| Package | Installed | Advisory | CVSS | Fixed in | Exact dependency path |
| --- | --- | --- | --- | --- | --- |
| `postcss` | 8.5.15 | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) — path traversal in previous-source-map auto-loading (`sourceMappingURL`) leading to arbitrary `.map` disclosure | 7.5 | 8.5.18 | `openmontage-remotion-composer` → `@remotion/cli@4.0.484` → `@remotion/bundler@4.0.484` → `css-loader@7.1.4` → `postcss@8.5.15` |
| `fast-uri` | 3.1.2 | [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx), [GHSA-4c8g-83qw-93j6](https://github.com/advisories/GHSA-4c8g-83qw-93j6) — host confusion via backslash authority delimiter / failed IDN canonicalization | 7.5 | 3.1.4 | `openmontage-remotion-composer` → `@remotion/cli@4.0.484` → `@remotion/bundler@4.0.484` → `webpack@5.105.0` → `schema-utils@4.3.3` → `ajv@8.20.0` → `fast-uri@3.1.2` |

**Production vs development exposure.** Both are reached only while `remotion render` bundles a
composition (webpack schema validation and CSS loading). Neither is loaded by the MES Electron
application at runtime, and neither is packaged into the MES installer.

**Reachability.** The `postcss` issue requires postcss to process CSS containing a crafted
`sourceMappingURL` comment. In this integration the CSS is authored by OpenMontage or by the
generated composition, not supplied by a remote party — so it is not reachable in the default
workflow. It *would* become reachable if an operator rendered an untrusted third-party Remotion
project on their machine, which is exactly what the exported editable projects invite third parties
to do in the other direction. The `fast-uri` issue affects `ajv`'s URI-format handling during
webpack option validation, where no security decision is taken on the parsed host; not reachable as
a vulnerability here.

**Why no fix is applied here.** `remotion-composer` lives in the pinned external OpenMontage
checkout (`0af32ce5e1e830c33992af1f9179dcdcd536549b`), which this work must not modify — see
`DECISIONS.md`. Both fixes are non-breaking patch bumps and are safe to apply *in that repository*
via `npm audit fix` or `overrides`, which is recorded as a follow-up against OpenMontage rather
than silently patched from MES.

### MES's own advisories, split by whether they ship

`npm audit` in MES reports 27 total (2 critical, 19 high, 6 moderate). Classified by whether the
vulnerable code is inside the shipped Electron application:

**Ships in the application**

| Package | Installed | Status |
| --- | --- | --- |
| `electron` | 32.x (`^32.1.2`) | Many advisories (highest CVSS 8.1, use-after-free in the offscreen child-window paint callback). The only published fix is `electron@43.2.0`, a **semver-major** jump. Not applied: the objective forbids forcing a breaking major purely to silence an advisory, and an Electron major crosses Chromium/Node versions, the native ABI and packaging. Tracked as a follow-up with its own validation pass. |
| `fast-uri` | 3.1.2 → **3.1.4** | Reached through a **runtime** dependency: `electron-store@8.2.0` → `conf@10.2.0` → `ajv@8.20.0` → `fast-uri@3.1.2`. `ajv` declares `fast-uri: ^3.0.1`, so `3.1.4` is in range — a **safe non-breaking patch override**, applied (see below). Practical reachability is nil: `ajv` validates the local settings schema, not attacker-supplied URLs. |
| `js-yaml` | 4.2.0 → **4.3.0** | **Correction to the earlier draft of this review, which recorded js-yaml as build-tooling only.** It also ships: `electron-updater@6.8.9` (a production dependency, loaded by `electron/services/updater.ts` for GitHub-Releases auto-update) depends on `js-yaml`. [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m) (high — quadratic CPU via YAML merge-key chains) affects 4.0.0–4.2.0. `electron-updater` declares `^4.1.0`, so `4.3.0` is in range — applied as a **non-breaking patch override**. Verify with `npm ls js-yaml --omit=dev`. |
| `react-router` / `react-router-dom` | 6.30.4 | Declared in `dependencies`, but **imported nowhere**: a repo-wide search for `from 'react-router`, `useNavigate` and `<Link` across `src/`, `electron/` and `shared/` returns no hits, and no router is mounted. Both advisories ([GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) open redirect via `<Link>`/`useNavigate`, [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) constructor injection in SSR hydration) require using the library, and MES has no SSR. **Unreachable**, and the only published fix is a semver-major 7.x jump, so it is not forced. Tracked as a follow-up to *remove* the unused dependency rather than upgrade it. |

**Does not ship — development/build tooling only**

- `builder-util-runtime` — the audit flags `9.2.10`, but that copy exists **only** under
  `electron-builder@25.1.8` (build tooling). The shipped consumer,
  `electron-updater@6.8.9`, already resolves `builder-util-runtime@9.7.0`, which is the **fixed**
  version for [GHSA-p2f4-r6v6-j797](https://github.com/advisories/GHSA-p2f4-r6v6-j797). The
  credential-leak advisory is therefore **not present on the shipped update path**.
- `app-builder-lib` — [GHSA-7g7r-gx96-252g](https://github.com/advisories/GHSA-7g7r-gx96-252g) is an
  `AppImage` search-path issue; MES is Windows-first and does not build AppImages.
- `tar` (critical), `node-gyp`, `@electron/node-gyp`, `make-fetch-happen`, `cacache`,
  `brace-expansion`, `electron-publish`, `electron-builder-squirrel-windows`, `dmg-builder`,
  `builder-util`, `@electron/rebuild`, `electron-builder` — all under the packaging/native-rebuild
  toolchain.
- `postcss` — MES reaches it only via `vite@5.4.21` (dev bundler).
- ~~`js-yaml` 4.2.0 — only under `electron-builder`~~ — **this was wrong; see the shipped table
  above.** `js-yaml` is also a transitive runtime dependency of `electron-updater`, so the high
  severity advisory did reach the shipped auto-update path. It is now overridden to 4.3.0. The
  packaging toolchain picks up the same override, which is harmless: 4.3.0 reads
  `electron-builder.yml` identically and `dist:dir` is re-validated after the change.
- `vite`, `vitest`, `playwright` — dev/test only. The `vitest` critical
  ([GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)) requires the Vitest **UI
  server** to be listening; this repository never starts it.
- `brace-expansion` — DoS only, dev-only, and the tree holds both 1.x and 2.x majors, so a single
  override risks breaking `minimatch` consumers. Not overridden.

### Fix applied

Two `overrides` entries, both in-range patch releases, both on paths that reach the **shipped**
application:

```json
"overrides": {
  "fast-uri": "3.1.4",
  "js-yaml": "4.3.0"
}
```

After applying them, `npm audit --omit=dev` drops from **1 high + 2 moderate** to **2 moderate**,
and the only remaining production findings are the two unreachable `react-router` advisories
analysed above.

Validated after the change: `npm run typecheck`, the full suite (73 files / 599 tests, 2 opt-in
skips), `npm run build`, and a Windows unpacked package — see `VALIDATION.md`.

No other advisory had a fix that was both available and non-breaking: everything else is either
development/build tooling that is not packaged, or requires a semver-major upgrade
(`electron` 32 → 43, `react-router` 6 → 7), which the objective explicitly forbids doing purely to
silence an advisory.

## Follow-ups (tracked, not silently accepted)

1. **`electron` 32 → 43** — semver-major; needs its own branch, native rebuild, smoke and packaging
   validation. Highest-value remaining item.
2. **OpenMontage `remotion-composer`** — apply `postcss@>=8.5.18` and `fast-uri@>=3.1.4` in the
   OpenMontage repository; MES must not patch a pinned external checkout.
3. **Remove the unused `react-router-dom` dependency.** It is declared but imported nowhere, so it
   contributes two production advisories and bundle weight for no functionality. Removal is a
   dependency change unrelated to this integration, so it is tracked rather than bundled here.
4. **`electron-builder` 26.x line** — packaging-toolchain upgrade, validate with a full `dist:dir`.
   (`js-yaml` itself is now fixed via the override above.)
5. **Run the real `codex-security` `security-diff-scan`** from an environment where that skill
   exists; this manual audit covers the same invariants but is not the skill's full pipeline.
