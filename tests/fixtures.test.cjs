const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const FIX=path.join(__dirname,'fixtures');
test('synthetic bike EDF passes the strict decoder and assembles with the template',async()=>{
  const {decodeEDF}=require('../src/core/edf.cjs'),data=decodeEDF(fs.readFileSync(path.join(FIX,'bike','model.edf')));
  assert.deepEqual(data.parts.map(p=>p.name),['chassis','fsusp','rsusp','steer']);
  const T=await import('three'),{buildEDF}=await import('../src/core/edf-scene.mjs'),{assemblyMatrix}=await import('../src/core/assembly.mjs');
  const profile=require('../src/core/assembly.json'),built=buildEDF(data),steer=built.get('steer');
  const m=assemblyMatrix(steer,profile),origin=new T.Vector3().applyMatrix4(m);assert.ok(origin.distanceTo(new T.Vector3(0,.995297372341156,.344514548778534))<1e-6);
});
test('synthetic rider.pkz yields both real-glove references at frame 24',async()=>{
  const {unzipSync}=await import('three/addons/libs/fflate.module.js'),z=unzipSync(fs.readFileSync(path.join(FIX,'rider.pkz')));
  const n=['rider/riders/default_mx/c_rider.edf','rider/animations/mx/rider.anm','rider/riders/default_mx/gfx.cfg'];
  const r=require('../src/core/hands.cjs').extractHands(z[n[0]],z[n[1]],Buffer.from(z[n[2]]).toString('utf8'));
  assert.equal(r.frame,24);
  for(const side of ['left','right']){const h=r.hands[side];assert.ok(h.indices.length>=90);for(const s of h.size)assert.ok(s>.025&&s<.3);}
  assert.deepEqual(r.hands.left.anchor,[.08,-.02,.02]);
});
test('fixture CFG has exactly one repairable typo and repeated plate blocks',()=>{
  const CFG=require('../src/core/cfg-core.js'),text=fs.readFileSync(path.join(FIX,'bike','gfx.cfg'),'utf8'),doc=CFG.parse(text);
  assert.deepEqual(CFG.issues(doc).map(i=>i.path),['cockpit.steer.rightgrip.pos.y']);
  assert.equal(CFG.repairNumeric(doc.fields.get('cockpit.steer.rightgrip.pos.y').value),'0.110');
  assert.equal(CFG.patch(doc,{}),text);assert.ok(text.includes('\r\n'));
});

test('bundled generic gloves extract through the same strict pipeline',async()=>{
  const {unzipSync}=await import('three/addons/libs/fflate.module.js'),z=unzipSync(fs.readFileSync(path.join(__dirname,'..','assets','generic-rider.pkz')));
  const n=['rider/riders/default_mx/c_rider.edf','rider/animations/mx/rider.anm','rider/riders/default_mx/gfx.cfg'];
  assert.match(Buffer.from(z['rider/readme.txt']).toString(),/not MX Bikes game data/);
  const r=require('../src/core/hands.cjs').extractHands(z[n[0]],z[n[1]],Buffer.from(z[n[2]]).toString('utf8'));
  for(const side of ['left','right']){const h=r.hands[side];assert.ok(h.indices.length/3>2000);for(const s of h.size)assert.ok(s>.05&&s<.3);}
});
