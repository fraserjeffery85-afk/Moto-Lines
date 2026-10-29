# Moto Lines — Claude development handover
Prepared 29 October 2026. Read this before the historical README.

## What this is
Moto Lines is an unsigned, portable Windows Electron desktop editor for MX Bikes gfx.cfg hand and chain lineups, created by OB Industries. It is a local tool: it reads the user's CFG, model and installed rider assets, previews the model in Three.js, and changes only a narrow set of CFG fields. It is not a full bike editor, a game physics simulator, or an EDF exporter.

The confirmed desktop shortcut targets Moto-Lines-v0.8.4-Windows/Moto Lines.exe, in the 2026-10-12/for/outputs workspace. The version remains 0.8.4 despite later in-place fixes. This handover uses the actual packaged application files as the runtime source of truth, plus build tooling and tests from the development folder. Do not infer that another unlocated build is newer.

## Package contents
- source/: complete first-party app code, assembly metadata, original Moto Lines PNG/ICO branding, package manifest, dependency lockfile, build script and existing tests.
- source/project.json: deliberately empty portable configuration. Configure local game paths on the receiving machine.
- embed-icon.py: Windows helper to embed the original multi-resolution ICO into the built executable. This is a parameterised copy of the helper used for the installed app.
- HISTORICAL-README.md: development history and earlier verification claims. Some sections describe superseded behavior. This handover and current source take precedence.
- VERIFICATION.txt: checks run while preparing this handover.
- FILE-HASHES.csv: hashes for the supplied source files.

Not included: Electron binaries, installed node_modules, game models, rider.pkz, Blender source scenes, user-data, recovery backups or the user's bike CFG files. Install dependencies to rebuild. Game assets must come from the user's installation. The included logo is the user's original branding.

## Technology and structure
Pinned direct dependencies: Electron 40.0.0, Three.js 0.180.0, @playwright/test 1.56.1. Plain HTML/CSS/JavaScript; no React, web server, database or cloud backend is required for normal use.

| File | Responsibility |
| --- | --- |
| main.cjs | Electron window, menus, dialogs, IPC, file opening/saving, rider extraction, startup configuration and model asset protocol |
| preload.cjs | Narrow contextBridge API between renderer and desktop process |
| renderer.js | UI state, scene/camera, model loading, markers/gizmos, hand overlay, draft edits, validation, undo/redo, save commands |
| cfg-core.js | CFG parser with character offsets, editable-field allowlist, validation, surgical patching and both-view copying |
| storage.cjs | Encoding detection, read/hash, backups, external-change detection and file replacement |
| edf.cjs / edf-worker.cjs | Supported EDF parsing in a worker; malformed/unsupported containers rejected |
| edf-scene.mjs | Constructs Three.js geometry from decoded EDF data |
| assembly.json / assembly.mjs | Recorded source fingerprints and component assembly transforms |
| hands.cjs | Rider mesh/animation parsing and extraction of posed left/right glove geometry |
| chain-reference.mjs | Chain-end and template rear-axle reference guide |
| index.html / style.css | Dark interface, original branding, collapsible settings and output preview |
| build.cjs | Copies Electron distribution, app files, Three.js and assets into a portable Windows folder |

The renderer has nodeIntegration disabled, contextIsolation enabled and sandbox enabled. IPC handlers check the originating window/main frame. Model texture requests are restricted to the selected model directory and an extension allowlist. Preserve these boundaries when extending the app.

## Editing contract
Editable fields (with optional cockpit. prefix):
- steer.leftgrip.pos.x/y/z
- steer.rightgrip.pos.x/y/z
- chassis.chain.pos.x/y/z
- chassis.chain.engine.x/y/z
- chassis.chain.axis and chassis.chain.ratio

Other fields are preserved. No new matching lineup fields are invented. XYZ controls, 0.001 increment buttons and transform arrows change component-local values. External and Cockpit select CFG sections, not separate automatically loaded models. Users must load another model themselves if the cockpit mesh differs.

Draft edits are separate from original text. CFG.patch replaces only recorded value spans, preserving unrelated characters, comments and line endings. Supported input encodings are UTF-8, UTF-16 little-endian and a Latin-1 fallback; UTF-16 big-endian is rejected.

Normal Save and Save as default to both views using the currently selected view as source. Separate mode preserves independent cockpit/external edits. Fixed-source modes and Save both views are available. All corresponding destination fields must exist. Destination draft values may be overridden in the effective save output by the selected source. Output preview shows the effective result. Validation blocks invalid supported fields and ambiguous duplicate editable paths.

The main process validates again before writing. Overwriting creates an exact pre-save backup under user-data/backups, grouped by bike/path hash. The opened file's hash detects outside changes; the destination is checked again before replacement. Temporary writes are flushed before replacement. Save as writes a new destination. Do not describe this as a perfect filesystem transaction: there is still a small check-to-replace race. Backups are pre-save originals, not necessarily valid newly saved outputs.

## Preview and coordinate behavior
EDF component names use chassis, steer, fsusp and rsusp. Assembly mode applies recorded Blender/template transforms outside the decoded component hierarchy. Original EDF vertices and child transforms stay intact. Markers, hands and gizmos use the same assembly frame; dragging a tilted local Y arrow edits CFG Y, not world height.

The original Husqvarna fingerprint identifies the historically verified reference. Other compatible models use a template approximation, visibly labelled unverified for that model. Packed component mode remains available. Source FBX, GLB/GLTF and OBJ previews are also supported by the renderer. Protected/unsupported EDF formats are not universally supported.

Hands are actual sampled glove geometry from the locally installed stock rider package, not generic markers. The required ZIP entries are rider/riders/default_mx/c_rider.edf, rider/animations/mx/rider.anm and rider/riders/default_mx/gfx.cfg. Hand reference alignment offsets/rotations affect only the overlay, never the bike CFG. Full runtime wrist orientation and game rider IK remain unverified.

Current chain display is an editable engine endpoint with a dashed reference to the template rear axle. The orange endpoint radius is 0.002. Earlier assumed sprocket rings and tangent chain runs were removed. chain.pos is saved but not simulated visually. Rear-axle reference controls are preview-only. There is no fixed editor travel limit for chain engine XYZ. This does not establish what the game accepts or how it constructs its chain.

## Fixes already included
1. Portable v0.8.3 removed personal startup paths and added rider package selection. Original Moto Lines executable icon was embedded separately.
2. v0.8.4 repairs a narrowly matched duplicated-decimal numeric string when opening and on numeric-input blur: 0.23.5 becomes 0.235; -0.0023.5 becomes -0.00235. It changes the draft only until Save. This is a heuristic, not proof of the user's intended value; review it before saving. Other malformed values stay invalid.
3. The new build reset project.json to {}, dropping the user's automatic hands configuration. The installed copy was restored to load C:/Program Files (x86)/Steam/steamapps/common/MX Bikes/rider.pkz. Both extracted hands were checked (1,145 vertices and 1,628 triangles each). The portable handover uses {} instead of assuming that machine-specific path.
4. On 16 October, the parser was changed to accept repeated plate blocks/fields under (cockpit.)chassis.plate and (cockpit.)steer.plate. All their source text is preserved. The fields Map retains the last value for repeated opaque plate paths, but these are outside the editable allowlist. Duplicate editable hand/chain definitions still fail. This resolved the Triumph TF 250-X error Duplicate block: cockpit.chassis.plate.

## Build and run
From source/, install dependencies using the included pnpm lockfile (pnpm install --frozen-lockfile). Check pnpm's Electron install-script policy if the binary is absent. Then npm start runs Electron. npm test runs the *.test.cjs tests; no Electron GUI is required for those unit tests.

On Windows, node build.cjs creates ../Moto-Lines-v0.8.4-Windows by default. MOTO_LINES_DIST overrides that directory. Use a fresh destination: the script is a simple copier, not a clean, incremental installer. It resets the packaged project.json to {}. Preserve or migrate a user's local configuration deliberately when upgrading; do not overwrite their user-data/backups.

After building, from the handover root run:
python embed-icon.py "C:/path/to/Moto-Lines-v0.8.4-Windows"

The standard build script copies logo assets but does not embed the icon in the EXE. The Python helper requires Windows. A shortcut can use resources/app/assets/moto-lines.ico. Keep the entire portable folder together; copying just the EXE will not work.

For local automatic startup, project.json may contain cfg, model and hands: {package: "absolute/path/to/rider.pkz"}. DGS_PROJECT overrides the config file, DGS_USER_DATA overrides profile/backup storage. Absent startup files are filtered out. Without automatic hands settings, use Rider reference settings → Load / reload rider hands and select the installed game's rider.pkz.

## Verification and remaining work
See VERIFICATION.txt for this handover's fresh checks. Existing smoke scripts are historical: several contain old executable versions, absolute local paths and model assumptions. Adapt them before use. Historical README geometry/UI verification is not a fresh certification of every present build.

The October 16 parser scan opened 34 installed GFX files; two others had malformed steer.plate.fbffd syntax. The repeated-block fix intentionally did not guess how to repair those. The game files were not modified. A live GUI check from the restricted agent session previously failed to launch Electron; later user screenshots confirmed the desktop app was running. Do not confuse unit/asset checks with full GUI end-to-end verification.

Known priorities for further development:
- Upgrade-safe configuration migration and persistent rider-source selection (current selection is held in memory; build resets startup configuration).
- Review duplicated-decimal repair UX: offer explicit confirmation/undo for inferred values instead of assuming all strings have one intended meaning.
- Refresh stale README and hardcoded smoke fixtures; add reproducible GUI tests.
- Version the post-0.8.4 fixes clearly and integrate executable branding into the build.
- Keep template placement, hand pose and chain limitations visible; test final lineups in MX Bikes.

Preserve the original branding and existing working hand/chain coordinate behavior. Do not rewrite bike CFGs, remove backups, replace game assets, loosen all parsing errors or claim to simulate game physics as part of a routine UI fix.
