// End-to-end test of in-app updates against a local stand-in for the GitHub API.
// Linux: xvfb-run -a node --test tests/gui/update.gui.cjs
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const core=require('../../src/main/update-core.cjs');
const ROOT=path.join(__dirname,'..','..'),SHOTS=process.env.MLS_SCREENSHOTS||null;
const {_electron}=require('playwright');
const pkg=require('../../package.json');

async function buildPackage(dir,version,priv){
  const app=path.join(dir,'app-src');
  await fs.cp(path.join(ROOT,'src'),path.join(app,'src'),{recursive:true});
  await fs.cp(path.join(ROOT,'assets'),path.join(app,'assets'),{recursive:true});
  for(const part of ['package.json','LICENSE','build','examples/jsm'])await fs.cp(path.join(ROOT,'node_modules','three',part),path.join(app,'node_modules','three',part),{recursive:true});
  await fs.writeFile(path.join(app,'package.json'),JSON.stringify({...pkg,version,devDependencies:undefined,scripts:undefined},null,2));
  const files=core.listFiles(app),{zipSync}=await import('three/addons/libs/fflate.module.js'),entries={};
  for(const rel of Object.keys(files))entries[rel]=new Uint8Array(await fs.readFile(path.join(app,...rel.split('/'))));
  const zip=Buffer.from(zipSync(entries,{level:1}));
  const manifest={format:1,version,released:'2026-10-29',minElectron:'40.0.0',notes:'Test release notes for '+version,zip:{name:`moto-lines-studio-app-${version}.zip`,size:zip.length,sha256:core.sha256(zip)},files};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2));
  return {zip,bytes,sig:core.sign(bytes,priv),manifest};
}
function serve(release){
  const hits=[];
  const server=http.createServer((req,res)=>{
    hits.push(req.url);const base=`http://127.0.0.1:${server.address().port}`;
    if(req.url==='/repos/test/mls/releases/latest'){res.setHeader('content-type','application/json');
      return res.end(JSON.stringify({tag_name:'v'+release.pkg.manifest.version,html_url:'https://github.com/test/mls/releases/tag/v'+release.pkg.manifest.version,
        assets:[{name:'update.json',browser_download_url:base+'/dl/update.json'},{name:'update.json.sig',browser_download_url:base+'/dl/update.json.sig'},{name:release.pkg.manifest.zip.name,browser_download_url:base+'/dl/app.zip'}]}));}
    if(req.url==='/dl/update.json')return res.end(release.pkg.bytes);
    if(req.url==='/dl/update.json.sig')return res.end(release.sig??release.pkg.sig);
    if(req.url==='/dl/app.zip')return res.end(release.pkg.zip);
    res.statusCode=404;res.end();
  });
  return new Promise(r=>server.listen(0,'127.0.0.1',()=>r({server,hits,url:`http://127.0.0.1:${server.address().port}`})));
}
async function launch(env){
  const app=await _electron.launch({timeout:60000,executablePath:require('electron'),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader',ROOT],env:{...process.env,...env}});
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));return {app,page,errors};
}
const close=async app=>{try{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));}catch{}await app.close().catch(()=>{});};
const shot=async(page,name)=>{if(SHOTS)await page.screenshot({path:path.join(SHOTS,name+'.png')});};

test('launch check asks first, then downloads, verifies and starts the new version',{timeout:300000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mls-update-gui-'));
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const pub=path.join(dir,'pub.pem');await fs.writeFile(pub,publicKey.export({type:'spki',format:'pem'}));
  const release={pkg:await buildPackage(dir,'9.9.9',privateKey.export({type:'pkcs8',format:'pem'}))};
  const {server,hits,url}=await serve(release);
  const userData=path.join(dir,'user-data');await fs.writeFile(path.join(dir,'project.json'),'{}');
  const env={MLS_USER_DATA:userData,MLS_PROJECT:path.join(dir,'project.json'),MLS_STEAM_DIRS:path.join(dir,'none'),MLS_ALLOW_DEV_UPDATES:'1',MLS_UPDATE_REPO:'test/mls',MLS_UPDATE_API:url,MLS_UPDATE_PUBKEY:pub};
  let {app,page,errors}=await launch(env);
  try{
    // Found on launch, but nothing is downloaded until asked.
    await page.waitForSelector('#updateBar:not([hidden])',{timeout:20000});
    assert.match(await page.textContent('#updateBar'),new RegExp(`Moto Lines Studio 9\\.9\\.9 is available\\. You have ${pkg.version.replace(/\./g,'\\.')}`));
    assert.ok(!hits.includes('/dl/app.zip'));
    await shot(page,'u1-available');
    await page.click('#updateBar button:has-text("What’s new")');
    assert.match(await page.textContent('#whatsNewText'),/Test release notes for 9\.9\.9/);
    await page.click('#whatsNew [data-close]');
    await page.click('#updateBar button:has-text("Download")');
    await page.waitForFunction(()=>/downloaded and checked/.test(document.querySelector('#updateBar').textContent),null,{timeout:60000});
    assert.ok(hits.includes('/dl/app.zip'));
    core.verifyInstalledSync(path.join(userData,'updates','app-9.9.9'),publicKey.export({type:'spki',format:'pem'}));
    await shot(page,'u2-ready');
    // Restart now: relaunch is stubbed so the test can start the app itself.
    await app.evaluate(({app})=>{app.relaunch=()=>{};});
    const exited=new Promise(r=>app.process().once('exit',r));
    await page.click('#updateBar button:has-text("Restart now")');await exited;
    assert.deepEqual(errors,[]);
  }finally{await close(app);}

  // The boot loader starts the downloaded version and records that it worked.
  ({app,page,errors}=await launch(env));
  try{
    await page.waitForFunction(()=>document.querySelector('#version').textContent==='Moto Lines Studio 9.9.9',null,{timeout:30000});
    await page.waitForTimeout(3500); // the launch check finds nothing newer: no bar
    assert.ok(await page.locator('#updateBar').isHidden());
    await page.keyboard.press('F1');await page.keyboard.press('Escape');
    assert.match(await page.textContent('#updateInfo'),new RegExp(`Running update 9\\.9\\.9 \\(this folder shipped ${pkg.version.replace(/\./g,'\\.')}\\)`));
    assert.equal(core.readState(path.join(userData,'updates')).good,'9.9.9');
    assert.deepEqual(errors,[]);
  }finally{await close(app);}

  // A modified file in the installed update: it is ignored and the shipped version runs.
  await fs.appendFile(path.join(userData,'updates','app-9.9.9','src','renderer','app.js'),'\n// tampered\n');
  ({app,page,errors}=await launch({...env,MLS_UPDATE_API:'http://127.0.0.1:9'}));
  try{
    await page.waitForFunction(v=>document.querySelector('#version').textContent==='Moto Lines Studio '+v,pkg.version,{timeout:30000});
  }finally{await close(app);}

  // A forged signature is refused: no bar on launch, and a manual check explains why.
  await fs.rm(path.join(userData,'updates'),{recursive:true,force:true});
  const forger=crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
  release.sig=core.sign(release.pkg.bytes,forger);
  ({app,page,errors}=await launch(env));
  try{
    await page.waitForFunction(v=>document.querySelector('#version').textContent==='Moto Lines Studio '+v,pkg.version,{timeout:30000});
    await page.waitForTimeout(3500);assert.ok(await page.locator('#updateBar').isHidden());
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('command','checkUpdates'));
    await page.waitForSelector('#message[open]');
    assert.match(await page.textContent('#messageText'),/signature is not valid/);
    await shot(page,'u3-forged');
    await assert.rejects(fs.access(path.join(userData,'updates','app-9.9.9')));
    assert.deepEqual(errors,[]);
  }finally{await close(app);server.close();await fs.rm(dir,{recursive:true,force:true});}
});
