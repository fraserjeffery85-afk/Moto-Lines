# Moto Lines Studio — development handover

Read README.md first for layout, contracts and commands. This note records what was verified for 1.0.0 and what was not.

## Baseline
1.0.0 was built from the Moto Lines 0.8.4 handover of 29 October 2026. The core modules (`cfg-core.js`, `edf.cjs`, `edf-worker.cjs`, `edf-scene.mjs`, `hands.cjs`, `assembly.*`, `chain-reference.mjs`) are byte-identical to 0.8.4. `storage.cjs` keeps the same save and backup behaviour; the backup path logic moved into `backupFolder()`, and list/read/restore were added. All 18 original tests still pass unchanged apart from their import paths.

## Verified for 1.0.0
- 30 unit tests (`npm test`).
- End-to-end Electron test (`npm run test:gui`) on Linux with SwiftShader, run against both the source tree and the packaged `resources/app` from `npm run build:win`.
- The built exe's embedded icon group (16–256 px) and version strings were read back with resedit.
- Running with no WebGL: the app reports it and editing/saving still work.

## Not verified
- The Windows exe has not been launched on Windows by the developer; the packaged app folder was exercised with the Linux Electron binary.
- No real game assets were available. Fixtures are synthetic. Use the `DGS_TEST_*` real-asset tests and check a real bike in MX Bikes.
- Game handedness (resolved in 1.1.1 after user report): 0.8.4 drew CFG/EDF X directly as Three.js X, a mirror image of the game. 1.1.1 reflects the `game-frame` group (scale.x = −1) for display only. Data, CFG values and assembly matrices are untouched. A headless TransformControls simulation confirmed drags still follow the cursor exactly on tilted local axes; the GUI test checks on-screen left/right.

## Discrepancies found in the 0.8.4 handover
- VERIFICATION.txt lists 14 tests; the supplied suite has 18 (the four in assembly, chain and reference tests weren't in that run).
- `pnpm-workspace.yaml` contained a placeholder (`electron: set this to true or false`), so pnpm would skip Electron's install script and leave no binary. 1.0.0 uses npm with `package-lock.json`.
- `chain-reference.mjs` still exports `chainTangents` and `assembly.json` still has illustrative sprocket radii, though rings and tangents were removed in 0.8.2. Kept, as they're tested and harmless.
- The historical README refers to a `Moto-Lines-v0.8.1-Windows` folder and a “Save as both views…” button; 0.8.4 used `v0.8.4` and “Save both views…”.
- 0.8.4 auto-applied the decimal repair on open and blur despite the handover listing confirmation as a priority; the close prompt also fired for mirrored-only differences with no edits.

## Updates (1.3.0)
- The signing key pair was generated on 29 October 2026. The private key was handed to the owner and isn't in the repository. It belongs in the GitHub secret `UPDATE_SIGNING_KEY`.
- The first build with the updater must be built in the owner's repo (Actions), so the repo name is baked in. Builds made elsewhere have updates turned off.
- Verified: unit tests for signing, tampering, path safety, selection and crash fallback; a GUI test of the full check → ask → download → verify → restart → run-new-version flow, plus tampered-install fallback and forged-signature refusal against a local fake GitHub; the release pipeline run locally with the real key, with its package installed and verified.
- Not verified: the GitHub Actions workflow itself (no repo was available), and real network behaviour on Windows.

## Next ideas
- Code-sign the exe to stop SmartScreen warnings.
- Per-model saved hand overlay alignment, and an option to remember chain guide settings.
- A Windows CI job running `npm test` and `npm run test:gui`.
