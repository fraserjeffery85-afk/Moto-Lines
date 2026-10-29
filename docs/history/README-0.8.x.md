# Moto Lines · 0.8.4

Created by OB Industries.

## Version 0.8.4: duplicated-decimal repair

When an older GFX contains a duplicated decimal separator such as `0.23.5` or `-0.0023.5`, Moto Lines now corrects that narrow formatting typo in the in-memory draft when the file opens. The original file is not changed until Save is used, and normal validation remains strict for ambiguous invalid values. The same correction is applied when leaving a numeric input after accidentally typing a second decimal separator.

Open **Moto Lines.exe** in the `Moto-Lines-v0.8.1-Windows` folder. Keep the whole folder together. The app is now named Moto Lines. A prominent **Save as both views…** button sits in the top toolbar next to Save as. The confirmed hand alignment geometry is unchanged.

## Save both views

Click **Save as both views…** at the top, choose which view supplies the lineups, then click **Choose file and save both…**. This saves one gfx.cfg containing both the third-person steer/chassis lineups and their cockpit counterparts. It is also available under File → Save As Both Views.

Use **Save output** beneath the view buttons:

- **Keep views separate** preserves independent cockpit and third-person values.
- **Both · use Third person** copies all supported third-person hand and chain lineup values into both sections.
- **Both · use Cockpit** does the reverse.

Then choose **Save as…** for a copy, or **Save GFX** to update the opened file with a backup. The GFX output preview shows exactly what will be written, including the matched values. Only supported lineup fields are copied; unrelated cockpit and third-person settings stay intact. Matching fields must already exist in both sections. The source choice overrides any different pending values in the destination view at save time; switching back to Keep views separate restores the separate draft preview before saving.

Automated checks cover both directions, pending edits, invalid source values and missing destination fields. A desktop Save as test compared the written file against the exact preview and verified the original CFG was unchanged.

## Blender assembly

The editor now restores the component positions and rotations from `N:/MODEL SWAPPING/BLENDS/OBM WIPS/Husqvarna/dgshusky.blend`. The authored steering angle is approximately 26.5 degrees. Chassis, steering, lower forks and swingarm appear together in their Blender positions.

Those four component transforms were independently compared with your original `N:/MODEL SWAPPING/MISC BLENDS NOT BIKES/mxb_bike_template/mxb_bike_template.blend`. The origins differ by less than 0.0005 mm and the rotations agree within numerical precision. Its export script uses the same component rotations, and the accompanying template geometry specifies 26.5 degrees. The editor retains your Husqvarna transforms; it does not substitute the template's physics settings for the OEM bike. Template matrices and the source fingerprint are recorded in `assembly.json`.

The displayed geometry still comes from your EDF. A transform outside each component restores its Blender placement; EDF vertices and child transforms remain unchanged. The same transform applies to the hand references, CFG markers and drag controls. Editing an angled Y arrow still changes local CFG Y, not world height. Switching the bike view never changes CFG output.

**Bike view → Blender assembly** is the default for your matching EDF. **Packed component** shows the isolated component for inspecting exported coordinates. The original model fingerprint identifies the verified Blender placement. Other compatible EDFs now use the MXB template assembly, explicitly labelled as an unverified template reference for that model. Nonstandard component names or absent components may need a separate source-model preview. Packed component view remains available.

This reproduces the **authored static Blender pose**. It does not simulate MX Bikes suspension, steering animation or rider IK. Confirm final lineups in the game. Wheels are not included in this supplied EDF; they are not invented in the preview. Materials are untextured.

## Actual rider hands

The editor reads the stock cockpit rider mesh, MX animation and rider attachment points from your installed game's `rider.pkz`. Game assets are not bundled in this release. The animation rotation convention is corrected, with an unchanged finger joint checked independently against its EDF rest rotation. Solid hand rendering avoids overlapping transparent surfaces.

The overlay is a sampled glove pose anchored using the rider CFG. Full runtime wrist orientation remains unverified. **Hand reference alignment** adjusts the overlay only and never changes the bike or CFG. Reset reference alignment restores those adjustments.

## Editing

1. Choose External or Cockpit, then Left hand, Right hand or Chain.
2. Use **Focus point** to inspect a hand; **Frame bike** or F shows the assembly.
3. Drag a coloured arrow, type XYZ values, or use the 0.001 increment buttons. Orbit with left drag, pan with right drag, and scroll to zoom.
4. Review the GFX output. **Save as…** writes a copy. **Save GFX** updates the opened file with a uniquely named exact backup first.

External and Cockpit select CFG sections. Both use the current model; load a separate cockpit model if it differs. Copy selected transfers one supported lineup between existing sections. Undo/redo covers field edits, gizmo drags and transfers.

## Chain alignment

Selecting **Chain** opens a view of the front and rear sprocket references, with upper and lower tangent guides. **Front sprocket** edits the CFG engine point live. The orange front ring and amber rear ring distinguish the two centres. The guide also reports their separation and lateral mismatch.

The rear axle range and sprocket plane come from the `bike.geom` beside your supplied MXB template, transformed with the assembled swingarm. They are template references, not verified OEM wheel geometry. The rear axle slider starts at the midpoint of the template range. Rear plane and ring sizes can be adjusted for preview; these controls never write to the CFG. The 35 mm front and 130 mm rear radii are illustrative, not inferred tooth counts.

**Mesh offset** retains the raw `chain.pos` editor. Its value is no longer shown as a floating sprocket marker or used to aim the camera. The guide does not simulate that field, chain mesh deformation, slack, suspension motion or texture travel. It is a static sprocket alignment aid. It appears in assembled mode when chassis and rear-suspension components are available; the rear reference remains template-based.

Missing fields are never invented; invalid supported values block saving. The editor preserves unrelated text, comments, newlines and supported encoding, and detects changes made to the opened CFG by another application.

## Verification

The supplied EDF has 129,543 vertices and 166,286 triangles. Every displayed vertex was compared with the corresponding Blender object's evaluated vertices after restoring assembly placement. Of those, 129,319 agree within 0.001 mm. The remaining 224 vertices belong to the brake lever and differ by at most 0.684 mm; the EDF geometry is retained. This small residual is not concealed by replacing the compiled mesh with the Blender mesh.

All 16 core/reference tests passed, including packed mesh preservation, restored steering angle, local/world coordinate round trips, rider joint rotation, CFG preservation, backup integrity and external-change detection. Desktop tests exercised dragging along the tilted local Y axis while preserving X and Z, packed-space dragging, undo/redo, section transfer, saving a fixture and loading another model. Both hand previews and the assembled bike were visually inspected. Test saves were made only to an isolated CFG copy; the original was verified unchanged.

The added chain test checks axle transformation and circle tangency. Desktop checks verify that front edits update the lateral measurement, rear preview adjustments leave CFG output unchanged, undo restores the front point, and the guide is hidden in packed-component mode. The original CFG remains unchanged after these checks.

## Files and rebuilding

Startup paths are stored in `resources/app/project.json` in the portable folder. Assembly matrices and source fingerprints are in `resources/app/assembly.json`. The Blender file is read only during reference extraction; you do not need Blender running to use this build. EDF, CFG and rider assets are read from their original local paths.

The adjacent source folder includes the implementation and tests. Install the pinned dependencies, then run `electron .`. `node --test tests/*.test.cjs` runs the tests; set `DGS_TEST_EDF`, `DGS_TEST_RIDER` and `DGS_TEST_ANM` to enable the real-asset checks. `node build.cjs` creates the portable Windows folder. Electron and Three.js licences are retained. This is an unsigned development build.



## Version 0.7: multiple bike models and missing-hand diagnosis

The single-Husqvarna assembly restriction is removed. Compatible EDFs use the supplied MXB template as a reference, while the original source retains its verified status. This does not establish every bike's OEM physics placement. Containers with extra b/c detail components show the primary chassis/steer/fsusp/rsusp set without superimposing multiple detail levels.

The reader now accepts finite empty-bounds sentinels and skips validated shape-animation records for static previews of shock/cable nodes. A scan of 67 installed model.edf files decoded 63 successfully. Four have protected or unsupported containers and still cannot be opened; an unprotected EDF export or source model is needed for those. This is broad tested compatibility, not a claim to decode every possible or encrypted EDF.

Open matching GFX loads the gfx.cfg next to the selected model, avoiding accidental use of another bike's lineups. Unsaved-change protection still applies. Reload rider hands reuses the configured stock rider source. Each hand reports whether its mesh is loaded and whether its XYZ fields are valid. Fix hidden hand fields focuses the first invalid field without changing it. Invalid positions are never guessed or automatically repaired.

The current original Husqvarna CFG contains three malformed heights written as 0.23.5. That hides both third-person hands and the right cockpit hand. The Yamaha CFG has valid positions; both hands were verified to appear after loading it. These source files were not edited by the tests.

Validation: 18 core/reference checks passed. Desktop checks covered missing-hand diagnostics, stock reload, matching Yamaha CFG loading, both views, and switching among Yamaha, Suzuki and GasGas EDF layouts. Original game CFG files were verified unchanged.


## Version 0.8: refined workspace

The main screen now prioritises the model and position controls. Model statistics, rider settings, display settings, copy/save options and accuracy details are expandable. Output preview is collapsed by default; Show output opens it. Frame bike is beside the camera views above the viewport. Save both views remains a visible top-bar action. The restrained black and alloy theme uses consistent spacing and typography. EDF, hand geometry and CFG calculations are unchanged. Desktop checks cover normal/minimum window sizes, output toggling, chain controls and saving both views to a fixture.

## Version 0.8.1: tidy backups
New overwrite backups are stored under user-data/backups in the app folder, grouped by bike and source path. Use Copy & save options → Open backups folder to find them. Keep the app folder to retain recovery copies. Existing .bak files in bike folders are left untouched.
The rear axle preview slider is limited to the template axle travel. Chain engine XYZ values have no fixed travel limit. Chain mesh offset values are saved but are not simulated by the alignment guide.

## Version 0.8.2: chain reference correction
Removed assumed sprocket rings and tangent chain runs. The editable engine point is shown as the chain end, with a dashed reference to the template rear axle. This does not simulate the in-game chain mesh or wrap. Z has no fixed editor travel limit.

## Both-view save and smaller chain marker
Normal Save and Save as default to copying all supported hand and chain values from the currently selected view into cockpit and external. The save options still allow separate views or a fixed source. Missing matching fields and invalid values block saving. The orange chain point radius is now 2 mm, down from 9 mm; this is a reference marker, not chain geometry.

## Portable release 0.8.3
Open your own GFX and model. Under Rider reference settings, choose Load / reload rider hands and select rider.pkz from your MX Bikes installation folder (Steam: Manage → Browse local files). No rider assets are bundled. This release starts with no personal file paths.
