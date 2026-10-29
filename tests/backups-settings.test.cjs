const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const CFG=require('../src/core/cfg-core.js'),storage=require('../src/core/storage.cjs');
const {Settings,sanitize,inspectLegacy,importLegacy,findLegacyNear}=require('../src/main/settings.cjs');
const sample='steer\r\n{\r\n\tleftgrip\r\n\t{\r\n\t\tpos\r\n\t\t{\r\n\t\t\tx = -0.33\r\n\t\t\ty = 0.235\r\n\t\t\tz = -0.03\r\n\t\t}\r\n\t}\r\n}\r\n';
const tmp=prefix=>fs.mkdtemp(path.join(os.tmpdir(),prefix));

test('backups are listed newest first, read exactly and restored with a fresh backup',async()=>{
  const dir=await tmp('mls-backups-');
  try{
    const bike=path.join(dir,'bike'),root=path.join(dir,'backups'),file=path.join(bike,'gfx.cfg');await fs.mkdir(bike);await fs.writeFile(file,sample);
    let loaded=await storage.readCfg(file);
    const v1=CFG.patch(CFG.parse(loaded.text),{'steer.leftgrip.pos.x':'-0.34'});
    await storage.safeWrite(file,v1,'utf8',loaded.hash,root);await new Promise(r=>setTimeout(r,5));
    loaded=await storage.readCfg(file);
    const v2=CFG.patch(CFG.parse(loaded.text),{'steer.leftgrip.pos.x':'-0.35'});
    await storage.safeWrite(file,v2,'utf8',loaded.hash,root);
    const list=await storage.listBackups(file,root);
    assert.equal(list.length,2);assert.ok(list[0].created>=list[1].created);
    assert.equal((await storage.readBackup(file,root,list[1].name)).text,sample);
    assert.equal((await storage.readBackup(file,root,list[0].name)).text,v1);
    // Restore the oldest (original) copy; the current file must itself be backed up.
    loaded=await storage.readCfg(file);
    const restored=await storage.restoreBackup(file,root,list[1].name,loaded.hash);
    assert.equal(await fs.readFile(file,'utf8'),sample);
    assert.equal(await fs.readFile(restored.backup,'utf8'),v2);
    assert.equal((await storage.listBackups(file,root)).length,3);
    assert.deepEqual(await fs.readdir(bike),['gfx.cfg']);
    // Stale hash and path traversal are refused.
    await assert.rejects(storage.restoreBackup(file,root,list[0].name,loaded.hash),/changed outside/);
    for(const bad of ['../gfx.cfg','gfx.cfg','other.cfg.2026-01-01T00-00-00-000Z.abcdef.bak','..\\x.bak'])
      await assert.rejects(storage.readBackup(file,root,bad),/Unknown backup/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('restoring keeps an invalid historical original byte for byte',async()=>{
  const dir=await tmp('mls-restore-');
  try{
    const root=path.join(dir,'b'),file=path.join(dir,'gfx.cfg'),broken=sample.replace('0.235','0.23.5');
    await fs.writeFile(file,broken);let loaded=await storage.readCfg(file);
    await storage.safeWrite(file,sample,'utf8',loaded.hash,root);
    const [only]=await storage.listBackups(file,root);loaded=await storage.readCfg(file);
    await storage.restoreBackup(file,root,only.name,loaded.hash);
    assert.equal(await fs.readFile(file,'utf8'),broken);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('settings sanitize unknown and invalid values and persist atomically',async()=>{
  const s=sanitize({riderPackage:'C:/MX/rider.pkz',prefs:{step:0.001,saveMode:'nope',grid:'yes',hack:1,handOpacity:55},recent:{cfg:[{path:'a.cfg'},{bad:1}],model:'x'}});
  assert.equal(s.riderPackage,'C:/MX/rider.pkz');assert.equal(s.prefs.saveMode,'auto');assert.equal(s.prefs.grid,true);assert.equal(s.prefs.handOpacity,55);
  assert.ok(!('hack' in s.prefs));assert.deepEqual(s.recent.cfg.map(r=>r.path),['a.cfg']);assert.deepEqual(s.recent.model,[]);
  const dir=await tmp('mls-settings-');
  try{
    const file=path.join(dir,'user-data','settings.json'),a=new Settings(file);await a.load();
    a.setPrefs({step:0.01,saveMode:'separate',drawer:'evil'});a.addRecent('cfg','C:/bikes/one/gfx.cfg');a.addRecent('cfg','C:/bikes/two/gfx.cfg');a.addRecent('cfg','c:/BIKES/one/gfx.cfg');await a.save();
    const b=new Settings(file);await b.load();
    assert.equal(b.data.prefs.step,0.01);assert.equal(b.data.prefs.saveMode,'separate');assert.equal(b.data.prefs.drawer,'changes');
    assert.equal(b.data.recent.cfg.length,2);assert.equal(b.data.recent.cfg[0].path,'c:/BIKES/one/gfx.cfg');
    await fs.writeFile(file,'{not json');const c=new Settings(file);await c.load();assert.equal(c.data.prefs.step,0.001);
    assert.ok((await fs.readdir(path.dirname(file))).some(n=>n.startsWith('settings.json.unreadable-')));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('older portable folders are detected and imported without overwriting anything',async()=>{
  const dir=await tmp('mls-legacy-');
  try{
    const old=path.join(dir,'Moto-Lines-v0.8.4-Windows'),app=path.join(old,'resources','app'),mine=path.join(dir,'Moto-Lines-Studio-v1.0.0-Windows');
    const rider=path.join(dir,'rider.pkz');await fs.writeFile(rider,'x');
    await fs.mkdir(app,{recursive:true});await fs.mkdir(mine);
    await fs.writeFile(path.join(app,'package.json'),JSON.stringify({name:'moto-lines',productName:'Moto Lines',version:'0.8.4'}));
    await fs.writeFile(path.join(app,'project.json'),JSON.stringify({hands:{package:rider},cfg:path.join(dir,'missing.cfg')}));
    const oldBackups=path.join(old,'user-data','backups','bike-abc');await fs.mkdir(oldBackups,{recursive:true});
    await fs.writeFile(path.join(oldBackups,'gfx.cfg.2026-10-01T00-00-00-000Z.aaaaaa.bak'),'old');
    await fs.writeFile(path.join(oldBackups,'gfx.cfg.2026-10-02T00-00-00-000Z.bbbbbb.bak'),'old2');
    const found=await findLegacyNear(mine);assert.equal(found.length,1);assert.equal(found[0].version,'0.8.4');assert.equal(found[0].backupCount,2);
    assert.equal((await inspectLegacy(app)).root,old);
    const root=path.join(mine,'user-data','backups');await fs.mkdir(path.join(root,'bike-abc'),{recursive:true});
    await fs.writeFile(path.join(root,'bike-abc','gfx.cfg.2026-10-01T00-00-00-000Z.aaaaaa.bak'),'mine');
    const settings=new Settings(path.join(mine,'user-data','settings.json'));await settings.load();
    const result=await importLegacy(found[0],settings,root);
    assert.deepEqual([result.copied,result.skipped,result.rider],[1,1,true]);
    assert.equal(await fs.readFile(path.join(root,'bike-abc','gfx.cfg.2026-10-01T00-00-00-000Z.aaaaaa.bak'),'utf8'),'mine');
    assert.equal(settings.data.riderPackage,rider);assert.deepEqual(settings.data.recent.cfg,[]);
    assert.equal(await fs.readFile(path.join(oldBackups,'gfx.cfg.2026-10-01T00-00-00-000Z.aaaaaa.bak'),'utf8'),'old');
    assert.equal(await inspectLegacy(mine),null);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
