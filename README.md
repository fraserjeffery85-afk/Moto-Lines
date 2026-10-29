# Moto Lines Studio

GFX tool for lining up hands and chains on MX Bikes model.edf files.

A portable Windows desktop editor for MX Bikes `gfx.cfg` hand and chain lineups, by OB Industries. Successor to Moto Lines 0.8.4. End-user instructions are in [`docs/READ ME.md`](docs/READ%20ME.md); this file is for development.

## Quick start

```bash
npm ci                      # Electron 40.0.0, Three.js 0.180.0, resedit, playwright
npm start                   # run from source
npm test                    # unit tests (no GUI)
xvfb-run -a npm run test:gui   # real Electron end-to-end test (Linux; on Windows just npm run test:gui)
npm run build:win           # dist/Moto-Lines-Studio-v<version>-Windows (+ .zip), icon embedded
npm run build:installer     # dist/installer/Moto-Lines-Studio-Setup-<version>.exe (NSIS, per-user; needs Wine with 32-bit support on Linux)
```

`npm run test:gui` drives the real app with Playwright's Electron support on a temporary copy of `tests/fixtures`. On Linux CI add `--use-angle=swiftshader` (already passed by the test) and run under `xvfb-run`. Set `MLS_SCREENSHOTS=<dir>` to keep screenshots, or `MLS_APP_ROOT=<dist>/…/resources/app` to test a packaged build.

`npm run build:win` works on Windows, macOS or Linux. Off Windows it downloads the official `electron-v40.0.0-win32-x64.zip` into `.cache/` and checks it against the release's `SHASUMS256.txt`. The ML icon and version info (OB Industries) are embedded with `resedit`; the exe is unsigned. The build refuses to overwrite an existing output folder.

## Updates

See [`docs/UPDATES.md`](docs/UPDATES.md) for setup and releasing. In short:

- `src/main/boot.cjs` is the entry point. It synchronously picks the newest verified version in `user-data/updates/app-<v>/` (newer than the shipped one, compatible Electron, not marked bad) and requires its `src/main/main.cjs`. Otherwise it runs the shipped app. Boot itself only changes with a full download.
- `src/main/update-core.cjs` (no Electron): Ed25519 manifest verification, install from zip with per-file SHA-256 checks, selection, crash fallback (`boot-state.json`: two failed starts → skipped), cleanup.
- `src/main/updater.cjs`: GitHub Releases check on launch (after the renderer starts), download only on request, progress events, skip, restart.
- Release assets: `update.json`, `update.json.sig`, `moto-lines-studio-app-<v>.zip` (resources/app), plus the full Windows zip. They're made by `npm run build:win` and `npm run make-update` (needs `MLS_UPDATE_KEY` or `MLS_UPDATE_KEY_FILE`), and published by `.github/workflows/release.yml` when `main` has an unreleased `package.json` version (it creates the tag).
- The update repo is written into the built `package.json` from `GITHUB_REPOSITORY` (Actions), `MLS_UPDATE_REPO`, or `package.json` `updates.github`. Public key: `src/main/update-public-key.pem` (`npm run keygen` makes a new pair and refuses to overwrite).
- Test hooks, which only work when running from source: `MLS_ALLOW_DEV_UPDATES=1`, `MLS_UPDATE_REPO`, `MLS_UPDATE_API`, `MLS_UPDATE_PUBKEY`. `tests/gui/update.gui.cjs` runs the whole flow against a local fake GitHub.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/main/main.cjs` | Window, menus, dialogs, IPC (sender-checked), file open/save, backups, rider extraction, model asset protocol |
| `src/main/preload.cjs` | Narrow `window.desktop` bridge |
| `src/main/paths.cjs` | Where user data lives: `%APPDATA%\Moto Lines Studio` when installed (uninstaller beside the exe), `user-data` beside a portable exe |
| `src/main/settings.cjs` | `user-data/settings.json` (rider.pkz, recents, prefs, window), validation, import from 0.8.x folders |
| `src/core/cfg-core.js` | CFG parser with offsets, editable-field allowlist, validation, surgical patch, both-view mirroring *(unchanged from 0.8.4)* |
| `src/core/storage.cjs` | Encoding, hashing, safe write with exact backups; now also list / read / restore backups |
| `src/core/edf*.{cjs,mjs}`, `hands.cjs`, `assembly.*`, `chain-reference.mjs` | EDF decoding, glove extraction, template assembly, chain guide *(unchanged from 0.8.4)* |
| `src/renderer/state.js` | Draft model: edits, coalesced undo, save modes, repair suggestions, mirror/transfer, symmetry, change list, compare, line diff |
| `src/renderer/viewport.js` | Three.js scene, markers, ghost, gizmo, hands, chain guide, cameras (coordinate logic ported 1:1) |
| `src/renderer/app.js` | UI wiring, drawer, dialogs, keyboard, startup |
| `scripts/make-fixtures.cjs` | Regenerates the synthetic bike EDF, CFG and rider.pkz in `tests/fixtures` |
| `scripts/build-windows.cjs` | Portable Windows build + zip |

Security boundaries are kept from 0.8.4: `contextIsolation`, `sandbox`, no `nodeIntegration`, sender/main-frame checks on every IPC handler, navigation and new windows blocked, CSP limited to `'self'`, and model textures served only from the opened model's folder with an extension allowlist. Backup names are validated before any read or restore.

## Contracts that must not change

- Only `steer.leftgrip.pos.*`, `steer.rightgrip.pos.*`, `chassis.chain.pos.*`, `chassis.chain.engine.*`, `chassis.chain.axis` and `chassis.chain.ratio` (each optionally under `cockpit.`) are editable. Fields are never invented.
- Saving patches recorded value spans only. Every other byte, comments, line endings and the encoding (UTF-8, UTF-16 LE, Latin-1) is preserved. Invalid values block saving in the renderer and again in the main process.
- Overwrites take an exact backup first under `user-data/backups/<bike>-<pathhash>/`. External changes are detected by hash. A small check-to-replace race remains.
- CFG values are component-local. In assembly mode one parent matrix places the component, markers, hands and gizmo. The scene's handedness is unchanged from 0.8.4.
- Duplicated-decimal repairs (`0.23.5 → 0.235`) are suggestions only and need explicit confirmation.
- The chain display is a reference guide. Hand overlay alignment never touches the CFG.

## Configuration

- `user-data/` beside the exe (or the repo when running from source) holds `settings.json` and `backups/`. Override with `MLS_USER_DATA` (`DGS_USER_DATA` still works).
- Optional auto-open for development: `project.json` in the app root, or `MLS_PROJECT` / `DGS_PROJECT`, with `{ "cfg": "...", "model": "...", "hands": { "package": ".../rider.pkz" } }`. Missing paths are ignored. It isn't shipped in builds; persistent settings replace it.

## Real-asset tests

The 0.8.4 real-asset checks still run when these are set: `DGS_TEST_EDF` (original Husqvarna `model.edf`), `DGS_TEST_RIDER` + `DGS_TEST_ANM` (extracted stock `c_rider.edf` and `rider.anm`; the rider `gfx.cfg` must sit beside the EDF).
