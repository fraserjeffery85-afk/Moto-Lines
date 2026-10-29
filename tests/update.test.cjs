const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const U=require('../src/main/update-core.cjs');
const keys=()=>{const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');return {pub:publicKey.export({type:'spki',format:'pem'}),priv:privateKey.export({type:'pkcs8',format:'pem'})};};
async function makePackage(version,{files={},minElectron='40.0.0',priv}={}){
  const {zipSync}=await import('three/addons/libs/fflate.module.js');
  const content={'package.json':JSON.stringify({version,main:'src/main/main.cjs'}),'src/main/main.cjs':`module.exports='${version}';\n`,'assets/a.txt':'x',...files};
  const entries=Object.fromEntries(Object.entries(content).map(([k,v])=>[k,new TextEncoder().encode(v)]));
  const zip=Buffer.from(zipSync(entries));
  const manifest={format:1,version,minElectron,released:'2026-10-29',notes:'Notes for '+version,zip:{name:`app-${version}.zip`,size:zip.length,sha256:U.sha256(zip)},
    files:Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,U.sha256(v)]))};
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2));
  return {zip,manifestBytes,signature:U.sign(manifestBytes,priv),manifest};
}

test('versions compare numerically',()=>{
  assert.equal(U.compare('1.10.0','1.9.9'),1);assert.equal(U.compare('1.2.0','1.2.0'),0);assert.equal(U.compare('0.9.0','1.0.0'),-1);
});

test('only correctly signed, well-formed manifests are accepted',async()=>{
  const k=keys(),other=keys(),p=await makePackage('1.3.0',{priv:k.priv});
  assert.equal(U.verifyManifest(p.manifestBytes,p.signature,k.pub).version,'1.3.0');
  assert.throws(()=>U.verifyManifest(p.manifestBytes,p.signature,other.pub),/signature is not valid/);
  const edited=Buffer.from(p.manifestBytes.toString().replace('Notes for','Hacked'));
  assert.throws(()=>U.verifyManifest(edited,p.signature,k.pub),/signature is not valid/);
  assert.throws(()=>U.verifyManifest(p.manifestBytes,'',k.pub),/signature is not valid/);
  for(const bad of [{format:2},{version:'1.3'},{zip:{name:'../x.zip',size:1,sha256:'0'.repeat(64)}},{files:{'../evil.js':'0'.repeat(64),'package.json':'0'.repeat(64),'src/main/main.cjs':'0'.repeat(64)}},{files:{'C:/evil.js':'0'.repeat(64),'package.json':'0'.repeat(64),'src/main/main.cjs':'0'.repeat(64)}},{files:{'a.txt':'0'.repeat(64)}}]){
    const bytes=Buffer.from(JSON.stringify({...p.manifest,...bad}));
    assert.throws(()=>U.verifyManifest(bytes,U.sign(bytes,k.priv),k.pub),/invalid/);
  }
});

test('install verifies the zip and every file, then boot selects the newest good version',async()=>{
  const k=keys(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'mls-upd-'));
  try{
    const root=path.join(dir,'updates');
    const p13=await makePackage('1.3.0',{priv:k.priv}),p14=await makePackage('1.4.0',{priv:k.priv}),p15=await makePackage('1.5.0',{priv:k.priv,minElectron:'41.0.0'});
    // Tampered zip bytes and a zip whose contents differ from the manifest are refused.
    const flipped=Buffer.from(p13.zip);flipped[flipped.length-30]^=1;
    await assert.rejects(U.installPackage({zipBytes:flipped,manifestBytes:p13.manifestBytes,signature:p13.signature,publicKeyPem:k.pub,root}),/doesn’t match its signed checksum/);
    const other=await makePackage('1.3.0',{priv:k.priv,files:{'extra.js':'evil'}});
    await assert.rejects(U.installPackage({zipBytes:other.zip,manifestBytes:p13.manifestBytes,signature:p13.signature,publicKeyPem:k.pub,root}),/doesn’t match its signed checksum/);
    await assert.rejects(fs.access(path.join(root,'app-1.3.0')));
    for(const p of [p13,p14,p15])await U.installPackage({zipBytes:p.zip,manifestBytes:p.manifestBytes,signature:p.signature,publicKeyPem:k.pub,root});
    // 1.5.0 needs a newer Electron, so 1.4.0 is chosen.
    let pick=U.selectApp({root,bundledVersion:'1.2.0',electronVersion:'40.0.0',publicKeyPem:k.pub});
    assert.equal(pick.version,'1.4.0');assert.ok(pick.skipped.some(s=>s.version==='1.5.0'&&/newer app/.test(s.reason)));
    assert.equal(require(path.join(pick.dir,'src/main/main.cjs')),'1.4.0');
    // A file modified after install makes that version unusable.
    await fs.writeFile(path.join(root,'app-1.4.0','assets','a.txt'),'changed');
    pick=U.selectApp({root,bundledVersion:'1.2.0',electronVersion:'40.0.0',publicKeyPem:k.pub});
    assert.equal(pick.version,'1.3.0');
    // A version that fails to start twice is skipped; one that started is kept.
    U.selectApp({root,bundledVersion:'1.2.0',electronVersion:'40.0.0',publicKeyPem:k.pub});
    pick=U.selectApp({root,bundledVersion:'1.2.0',electronVersion:'40.0.0',publicKeyPem:k.pub});
    assert.equal(pick.version,'1.2.0');assert.ok(pick.skipped.some(s=>s.version==='1.3.0'&&/twice/.test(s.reason)));
    assert.deepEqual(U.readState(root).bad,['1.3.0']);
    U.markGood(root,'1.3.0');
    assert.equal(U.selectApp({root,bundledVersion:'1.2.0',electronVersion:'40.0.0',publicKeyPem:k.pub}).version,'1.3.0');
    // A newer shipped app wins over older installed updates; a foreign key is ignored.
    assert.equal(U.selectApp({root,bundledVersion:'1.9.0',electronVersion:'40.0.0',publicKeyPem:k.pub}).version,'1.9.0');
    assert.equal(U.selectApp({root,bundledVersion:'1.2.0',electronVersion:'40.0.0',publicKeyPem:keys().pub}).version,'1.2.0');
    // Cleanup keeps the running and previous versions only.
    await fs.mkdir(path.join(root,'app-1.0.0'));await fs.mkdir(path.join(root,'app-1.6.0.partial-abcd'));
    await U.cleanup(root,['1.3.0']);
    assert.deepEqual((await fs.readdir(root)).filter(n=>n.startsWith('app-')).sort(),['app-1.3.0','app-1.4.0','app-1.5.0']);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
