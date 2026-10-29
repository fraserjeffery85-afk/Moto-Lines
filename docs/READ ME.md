# Moto Lines Studio 1.3.1

Created by OB Industries. A local editor for MX Bikes `gfx.cfg` hand and chain lineups. It replaces Moto Lines 0.8.4.

## Start

1. Run **Moto-Lines-Studio-Setup-<version>.exe**. It installs in a few seconds, adds a **Moto Lines Studio** shortcut to your desktop and Start menu, and opens the app. Windows may warn that the installer is unsigned; choose *More info → Run anyway*. No admin password is needed.
2. **Open model**: choose the bike's `model.edf` (or an FBX/GLB/glTF/OBJ source). If a `gfx.cfg` sits next to it, it opens automatically.
3. **Rider hands** show straight away. If MX Bikes is installed through Steam, the app uses the real stock glove from its `rider.pkz`. Otherwise it shows generic gloves that come with the app; press *Load rider.pkz…* and choose `rider.pkz` from your MX Bikes folder (Steam → MX Bikes → Manage → Browse local files) for the exact stock glove. The app remembers it.

To remove the app: Windows *Settings → Apps → Moto Lines Studio → Uninstall*.

## Coming from Moto Lines 0.8.x

Use *Help → Import from older Moto Lines…* and choose the old folder. This copies its recovery backups and adopts its rider.pkz location. The old folder isn't changed.

## Editing

- Pick **Third person** or **Cockpit**, then **Left hand**, **Right hand** or **Chain** (keys 1, 2, 3; V switches view).
- Drag the coloured arrows, type in X/Y/Z, use − / +, or the arrow keys and PgUp/PgDn. **Step** sets the increment (0.0001, 0.001 or 0.01); hold Shift for ten steps.
- **Keep hands symmetric** (key L) links the grips: moving one hand moves the other as its mirror image (X flipped, Y and Z the same), however you move it. If they don't match when you turn it on, pick which hand to keep. Reset and Copy then act on both hands.
- **Mirror to right/left** copies a hand to the other side with X flipped. The readout at the bottom of the viewport shows grip spread and whether the bars are symmetric.
- A white wire ball marks where the point was when you opened the file.
- **Copy to cockpit / third person** copies the selected lineup to the other view.

## Saving

- By default **Save GFX** writes both views from the view you're editing. Change this under *When saving*. **Save both views…** lets you pick the source view and a new file.
- The **Changes** tab lists every line that will change, including lines copied into the other view. **Full output** shows the exact file.
- Before overwriting, the previous file is copied to `user-data/backups`. The **Backups** tab lists those copies for the open file, compares them with the current file and restores one. Restoring backs up the current file first.
- Only hand and chain fields are ever changed. Comments, other settings, line endings and encoding are kept exactly.

## Typos

Older files sometimes contain a doubled decimal point such as `0.23.5`. Moto Lines Studio lists these when the file opens and suggests a fix (`0.235`). Nothing changes until you apply a suggestion, and Undo reverts it. Saving is blocked while any hand or chain value is invalid.

## Limits

- The preview shows left and right as in MX Bikes. *Display → Match MX Bikes left and right* switches to the mirrored view that Moto Lines 0.8.4 showed; CFG values are the same either way.
- The preview is a static pose. Suspension, steering and rider IK aren't simulated.
- The chain guide is a dashed line to the template rear axle, not the game's chain.
- Bike placement is verified only for the original Husqvarna. Other EDFs use the MXB template and are marked *MXB template placement*.
- The bundled generic gloves are close to the stock glove but not exact; line up with the real rider.pkz when you can.
- The hand overlay from rider.pkz is the real stock glove mesh; the game's wrist orientation isn't verified. *Hand overlay alignment* moves the overlay only.
- Some EDFs are protected and can't be read; use an FBX/GLB source for those.

Always check final lineups in MX Bikes.

## Updates

Each time it opens, the app checks github.com/fraserjeffery85-afk/Moto-Lines for a newer version and asks before downloading it. Updates are signed and checked before they're installed. Help → Check for updates… checks on demand; Help → About turns the launch check off.

## Your data

Everything stays on this computer. Settings, recovery backups and downloaded updates live in `%APPDATA%\Moto Lines Studio` (type that into the File Explorer address bar to open it). Uninstalling the app leaves them in place.
