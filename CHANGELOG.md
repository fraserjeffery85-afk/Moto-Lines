# Changelog

## 1.3.0 (29 October 2026)

### New
- **In-app updates from GitHub Releases.** Each launch checks for a newer version and shows a bar with Download, What’s new, Skip this version and Not now. Nothing downloads until you click Download. When it’s ready, Restart now switches over; otherwise it starts the next time the app opens.
- Updates are signed. The app only installs a package whose Ed25519 signature matches the public key built into it, and checks the download and every file against signed SHA-256 hashes.
- Updates are installed beside the app in user-data/updates; the app folder is never overwritten. A small boot loader starts the newest verified version. If an update is modified, or fails to start twice, the app runs the previous working version instead.
- Help → Check for updates…, and an option in About to turn the launch check off.
- Releases are built, tested, signed and published by GitHub Actions whenever main has a new version number (.github/workflows/release.yml).

## 1.2.0 (29 October 2026)

### New
- **Generic gloves bundled** (`assets/generic-rider.pkz`, 35 KB): original glove geometry made for this app, not MX Bikes game data, packaged in the same rider format and read by the same extractor. People you send the app to see hands straight away.
- Order of preference at start-up: a rider.pkz you chose before → rider.pkz found in Steam's MX Bikes folder → the generic gloves. The generic gloves are labelled ("generic glove" in Rider hands, a notice in the viewport with *Load rider.pkz…* and *Hide*) and are never saved as your rider choice, so the real stock glove takes over as soon as it's loaded.

### Changed
- The Rider camera sits further back so both gloves are in view.

## 1.1.1 (29 October 2026)

### Fixed
- **Bike shown mirrored.** MX Bikes coordinates are X right / Y up / Z forward (left grip and chain at negative X); drawing them directly in Three.js (right-handed) showed a mirror image, as 0.8.4 did. The preview now applies one view-only reflection so left and right match the game. CFG values, saved output and gizmo dragging are unaffected; dragging was checked to follow the cursor exactly. *Display → Match MX Bikes left and right* switches back to the 0.8.4 view.
- **Hands not appearing on a fresh install.** When no rider.pkz is saved, the app now looks for it in Steam's MX Bikes folder, including extra Steam libraries from `libraryfolders.vdf`, and loads the gloves automatically.
- When the gloves still can't show, a notice in the viewport says why: rider.pkz not loaded (with a *Load rider hands…* button), or the exact field hiding a hand (with *Use 0.235*-style fix or *Go to field*). The typo dialog now says when a typo hides a hand.

### Changed
- The *Bars* camera is now *Rider*: from behind the rider looking down the bars. *Left* and *Right* views show the bike's own left (chain) and right sides.

## 1.1.0 (29 October 2026)

### New
- **Keep hands symmetric** switch (key L) under the coordinates. While on, typing, − / +, arrow keys and gizmo drags on one grip move the other grip as its mirror image (X negated, Y and Z identical), as a single undo step. It applies per view and only where both grips exist.
- If the hands don't match when you switch it on, it asks which hand to keep (*Match right to left* / *Match left to right*); nothing is changed until you choose.
- While linked, Reset and Copy to cockpit/third person act on both hands. The plate shows "both hands" and the readout shows "Symmetric · linked".
- The switch is remembered between sessions.

## 1.0.0 — Moto Lines Studio (29 October 2026)

Renamed from Moto Lines and rebuilt around the unchanged 0.8.4 core (CFG parser and patcher, safe save, EDF reader, glove extraction, template assembly, chain guide). The ML plate logo is kept.

### New
- Redesigned interface: plate-style inspector coloured by lineup, large coordinate readouts, live values in the lineup list, welcome screen with recent files.
- Step size control (0.0001 / 0.001 / 0.01) shared by buttons, keyboard and gizmo snap. Arrow keys and PgUp/PgDn nudge; Shift for ×10; `[` `]` change step.
- Symmetry readout for the grips: spread, centre offset, height and reach difference.
- **Mirror to other hand** (X flipped, Y/Z kept) as one undo step.
- Ghost marker of the opened position with a delta under each coordinate.
- Bottom drawer: **Changes** (every line that will change, including mirrored copies), **Full output** with changed lines highlighted, **Compare views** (third person vs cockpit), **Backups** (list, compare, restore).
- Restoring a backup writes its exact bytes after backing up the current file.
- Persistent settings in `user-data/settings.json`: rider.pkz location, recent files, display and save preferences, hand overlay alignment, window size.
- Import from an older Moto Lines portable folder (detected automatically when it sits next to the new one): copies backups without overwriting, adopts the rider.pkz path.
- Bars camera, left/right side cameras, keyboard shortcuts dialog (F1), About dialog listing the limitations.
- If WebGL can't start, the app keeps working without the 3D preview instead of failing.
- Dropping a `rider.pkz` onto the window loads hands. Opening a model with a `gfx.cfg` beside it opens that CFG when none is open.

### Changed
- Duplicated-decimal repair is now a confirmation dialog and inline “Use …” suggestion; nothing is applied silently on open or on blur.
- Typing in a coordinate is one undo step per field, not one per keystroke.
- “Unsaved” and the close prompt count only your own edits. Fields that saving will mirror into the other view appear in Changes.
- Save both views no longer leaves the save mode switched afterwards.
- File check lists every invalid source field when mirroring views, with a link to each.
- Build embeds the icon and version info itself (no separate `embed-icon.py`), verifies the Electron download, never overwrites an existing build, and produces a zip.

### Tests
- New unit tests for backups/restore, settings, legacy import, draft state, fixtures.
- Synthetic bike EDF, CFG and rider.pkz fixtures generated by `scripts/make-fixtures.cjs`.
- End-to-end Electron test covering repair confirmation, editing, undo, keyboard, mirror, byte-exact save, backups, restore and persisted settings, runnable against source or a packaged build.

## 0.8.4 and earlier
See `docs/history/`.
