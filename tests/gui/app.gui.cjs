// End-to-end test of the real Electron app on synthetic fixtures.
// Linux CI: xvfb-run -a npm run test:gui     Windows: npm run test:gui
// Needs the `playwright` package (npm i -D playwright); no browser download is used.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const CFG=require('../../src/core/cfg-core.js');
const ROOT=path.join(__dirname,'..','..'),FIX=path.join(ROOT,'tests','fixtures');
const SHOTS=process.env.MLS_SCREENSHOTS||null;
const {_electron}=require('playwright');

async function launch(dir,project,extraEnv={}){
  await fs.writeFile(path.join(dir,'project.json'),JSON.stringify(project));
  const args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader',process.env.MLS_APP_ROOT||ROOT]; // MLS_APP_ROOT: test a packaged resources/app
  const app=await _electron.launch({timeout:60000,executablePath:require('electron'),args,
    env:{...process.env,MLS_PROJECT:path.join(dir,'project.json'),MLS_USER_DATA:path.join(dir,'user-data'),MLS_STEAM_DIRS:path.join(dir,'no-steam'),...extraEnv}});
  const page=await app.firstWindow();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1480,height:900}).catch(()=>{});
  return {app,page,errors};
}
const shot=async(page,name)=>{if(SHOTS)await page.screenshot({path:path.join(SHOTS,name+'.png')});};
const close=async app=>{try{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));}catch{}await app.close().catch(()=>{});};

test('edit, mirror, save with backup, restore, and persisted settings',{timeout:240000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mls-gui-'));
  await fs.cp(FIX,dir,{recursive:true});
  const cfgPath=path.join(dir,'bike','gfx.cfg'),original=await fs.readFile(cfgPath);
  const project={cfg:cfgPath,model:path.join(dir,'bike','model.edf'),hands:{package:path.join(dir,'rider.pkz')}};
  let {app,page,errors}=await launch(dir,project);
  try{
    // Startup: typo suggestions are offered, not applied.
    await page.waitForSelector('#repairs[open]',{timeout:45000});
    assert.equal(await page.locator('#repairRows tr').count(),1);
    assert.match(await page.textContent('#repairRows'),/0\.11\.0[\s\S]*0\.110/);
    assert.ok(await page.locator('#unsaved').isHidden());
    await shot(page,'01-repairs');
    await page.click('#repairApply');
    await page.waitForFunction(()=>document.querySelector('#handVisibility').textContent.includes('Left: shown'),null,{timeout:30000});
    assert.equal((await page.textContent('#unsaved')).trim(),'1 unsaved edit');
    assert.match(await page.textContent('#modelBadge'),/MXB template/);
    assert.match(await page.textContent('#hud'),/Not symmetric/);

    // Typing coalesces; undo restores; keyboard nudge uses the step size.
    await page.fill('#pos-x','-0.405');await page.locator('#pos-x').blur();
    assert.match(await page.textContent('.coord .was'),/was -0\.4/);
    assert.match(await page.textContent('#legend'),/Saved position/);
    await page.click('#undo');assert.equal(await page.inputValue('#pos-x'),'-0.4');
    await page.click('#viewport canvas',{position:{x:5,y:5}});
    await page.keyboard.press('ArrowRight');assert.equal(await page.inputValue('#pos-x'),'-0.399');
    await page.keyboard.press(']');await page.keyboard.press('Shift+ArrowLeft');assert.equal(await page.inputValue('#pos-x'),'-0.499');
    await page.keyboard.press('[');await page.click('#undo');await page.click('#undo');assert.equal(await page.inputValue('#pos-x'),'-0.4');

    // Symmetric hands: L links them, the fix prompt offers which hand to keep,
    // then one keypress moves both (X mirrored) as a single undo step.
    await page.keyboard.press('l');
    assert.ok(await page.locator('#linkHands').isChecked());
    await page.waitForSelector('#linkFix:not([hidden])');
    await page.click('#matchFromLeft');
    assert.ok(await page.locator('#linkFix').isHidden());
    await page.click('#viewport canvas',{position:{x:5,y:5}});
    await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowUp');
    assert.equal(await page.inputValue('#pos-x'),'-0.399');
    assert.match(await page.textContent('#vals-rightgrip'),/^0\.399\s+0\.111\s+−0\.070$/);
    assert.match(await page.textContent('#hud'),/Symmetric · linked/);
    await page.click('[data-part="rightgrip"]');await page.fill('#pos-z','-0.08');await page.locator('#pos-z').blur();
    assert.match(await page.textContent('#vals-leftgrip'),/−0\.080$/);
    await shot(page,'02a-linked');
    for(let i=0;i<3;i++)await page.click('#undo');
    assert.match(await page.textContent('#vals-leftgrip'),/^−0\.400\s+0\.110\s+−0\.070$/);
    await page.click('[data-part="leftgrip"]');await page.click('#viewport canvas',{position:{x:5,y:5}});
    await page.keyboard.press('l');assert.ok(!(await page.locator('#linkHands').isChecked()));

    // Mirror left → right makes the bars symmetric.
    await page.click('#mirror');
    await page.waitForFunction(()=>document.querySelector('#hud').textContent.startsWith('Symmetric'));
    await page.click('[data-tab="changes"]');await shot(page,'02-mirrored');
    await page.click('[data-tab="compare"]');await shot(page,'03-compare');
    await page.click('[data-part="chain"]');await page.waitForTimeout(400);await shot(page,'04-chain');
    assert.match(await page.textContent('#hud'),/Chain end to rear axle/);
    await page.click('[data-part="leftgrip"]');
    await page.click('#riderCam');await page.waitForTimeout(300);await shot(page,'05-rider');
    // Game handedness: from the rider's seat the left grip is on the left of the screen,
    // and from the bike's left side the front points left (as in MX Bikes).
    const scr=await page.evaluate(()=>({l:window.__mls.vp.markerScreen('leftgrip'),r:window.__mls.vp.markerScreen('rightgrip')}));
    assert.ok(scr.l.x<scr.r.x,'left grip must be screen-left in the rider view');
    await page.click('[data-cam="left"]');await page.waitForTimeout(200);
    const side=await page.evaluate(()=>({front:window.__mls.vp.project([0,.5,1]),rear:window.__mls.vp.project([0,.5,-1])}));
    assert.ok(side.front.x<side.rear.x,'left-side view must show the front on the left');
    await shot(page,'05b-left-side');
    await page.click('details:has(#gameHanded) > summary');
    await page.click('#gameHanded');await page.waitForTimeout(100); // 0.8.4 mirror view, values unchanged
    await page.click('#riderCam');await page.waitForTimeout(200);
    const mirrored=await page.evaluate(()=>({l:window.__mls.vp.markerScreen('leftgrip'),r:window.__mls.vp.markerScreen('rightgrip')}));
    assert.ok(mirrored.l.x>mirrored.r.x,'switched off, the 0.8.4 mirror image returns');assert.equal(await page.inputValue('#pos-x'),'-0.4');
    await page.click('#gameHanded');

    // Save over the file: both views from Third person; exact bytes elsewhere.
    await page.click('#save');
    await page.waitForFunction(()=>/^Saved /.test(document.querySelector('#status').textContent),null,{timeout:20000});
    const saved=await fs.readFile(cfgPath,'utf8'),doc=CFG.parse(original.toString('utf8'));
    const expected=CFG.patch(doc,CFG.matchViews(doc,{'steer.rightgrip.pos.x':'0.4','steer.rightgrip.pos.y':'0.11','steer.rightgrip.pos.z':'-0.07','cockpit.steer.rightgrip.pos.y':'0.110'},'external'));
    assert.equal(saved,expected);assert.ok(saved.includes('\r\n')&&saved.includes('texture = "plate_side_r.tga"'));
    assert.ok(await page.locator('#unsaved').isHidden());
    await page.click('[data-tab="backups"]');
    await page.waitForSelector('.backups li');assert.equal(await page.locator('.backups li').count(),1);
    await page.click('.backups li button:has-text("Compare")');await page.waitForSelector('.backupdiff pre');
    assert.match(await page.textContent('.backupdiff'),/0\.11\.0/);await shot(page,'06-backups');

    // Restore the recovery copy (native confirmation answered from the main process).
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
    await page.click('.backups li button:has-text("Restore")');
    await page.waitForFunction(()=>/restored/.test(document.querySelector('#status').textContent),null,{timeout:20000});
    assert.deepEqual(await fs.readFile(cfgPath),original);
    await page.waitForFunction(()=>document.querySelectorAll('.backups li').length===2);

    // Preferences persist.
    await page.click('[data-step="0.01"]');await page.waitForTimeout(500);
    assert.deepEqual(errors,[]);
  }finally{await close(app);}

  // Second launch without auto-open: welcome screen, recent file, saved prefs, remembered rider.
  ({app,page,errors}=await launch(dir,{}));
  try{
    await page.waitForSelector('#welcome:not([hidden])');
    await page.waitForSelector('#recentList li');
    assert.match(await page.textContent('#recentList'),/bike/);
    assert.ok(await page.locator('[data-step="0.01"].active').count());
    await page.waitForFunction(()=>document.querySelector('#handVisibility').textContent.includes('Left: loaded'),null,{timeout:30000});
    await shot(page,'00-welcome');
    const settings=JSON.parse(await fs.readFile(path.join(dir,'user-data','settings.json'),'utf8'));
    assert.equal(settings.riderPackage,project.hands.package);assert.equal(settings.prefs.step,0.01);
    assert.deepEqual(errors,[]);
  }finally{await close(app);}

  // Fresh install, no MX Bikes found: the bundled generic gloves show straight away,
  // are labelled as generic, and are not remembered as the rider choice.
  ({app,page,errors}=await launch(dir,{cfg:cfgPath,model:project.model},{MLS_USER_DATA:path.join(dir,'fresh-1')}));
  try{
    await page.waitForSelector('#repairs[open]',{timeout:45000});await page.click('#repairApply');
    await page.waitForFunction(()=>document.querySelector('#handVisibility').textContent.includes('Left: shown (generic glove)'),null,{timeout:30000});
    assert.match(await page.textContent('#callout'),/Showing generic gloves/);
    assert.equal((await page.textContent('#loadHands')).trim(),'Load MX Bikes rider.pkz');
    await shot(page,'07-generic-gloves');
    await page.click('#callout button:has-text("Hide")');assert.ok(await page.locator('#callout').isHidden());
    await page.waitForTimeout(400);
    const s=JSON.parse(await fs.readFile(path.join(dir,'fresh-1','settings.json'),'utf8').catch(()=>'{}'));assert.ok(!s.riderPackage);
    assert.deepEqual(errors,[]);
  }finally{await close(app);}
  // With MX Bikes in a secondary Steam library, rider.pkz is found and the gloves load by themselves.
  const steam=path.join(dir,'Steam'),lib=path.join(dir,'SteamLibrary'),pkz=path.join(lib,'steamapps','common','MX Bikes','rider.pkz');
  await fs.mkdir(path.join(steam,'steamapps'),{recursive:true});await fs.mkdir(path.dirname(pkz),{recursive:true});
  await fs.copyFile(path.join(dir,'rider.pkz'),pkz);
  await fs.writeFile(path.join(steam,'steamapps','libraryfolders.vdf'),`"libraryfolders"\n{\n\t"1"\n\t{\n\t\t"path"\t\t"${lib}"\n\t}\n}\n`);
  ({app,page,errors}=await launch(dir,{cfg:cfgPath,model:project.model},{MLS_USER_DATA:path.join(dir,'fresh-2'),MLS_STEAM_DIRS:steam}));
  try{
    await page.waitForSelector('#repairs[open]',{timeout:45000});await page.click('#repairSkip');
    await page.waitForFunction(()=>document.querySelector('#handVisibility').textContent.includes('Left: shown'),null,{timeout:30000});
    // The cockpit typo hides the right cockpit hand: the callout names it and offers the fix.
    await page.click('#cockpit');
    assert.match(await page.textContent('#callout'),/Right hand hidden: cockpit\.steer\.rightgrip\.pos\.y is 0\.11\.0/);
    await shot(page,'08-callout-hidden-hand');
    await page.click('#callout button');
    assert.ok(await page.locator('#callout').isHidden());
    assert.match(await page.textContent('#handVisibility'),/Right: shown/);
    const settings=JSON.parse(await fs.readFile(path.join(dir,'fresh-2','settings.json'),'utf8'));assert.equal(settings.riderPackage,pkz);
    assert.deepEqual(errors,[]);
  }finally{await close(app);await fs.rm(dir,{recursive:true,force:true});}
});
