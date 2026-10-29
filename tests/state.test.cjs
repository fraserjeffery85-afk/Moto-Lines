const {test}=require('node:test'),assert=require('node:assert/strict'),CFG=require('../src/core/cfg-core.js');
const load=()=>import('../src/renderer/state.js');
const lineup=(lx,ly,lz,rx,ry,rz,ex='-0.074')=>`steer\n{\n\tleftgrip\n\t{\n\t\tpos\n\t\t{\n\t\t\tx = ${lx}\n\t\t\ty = ${ly}\n\t\t\tz = ${lz}\n\t\t}\n\t}\n\trightgrip\n\t{\n\t\tpos\n\t\t{\n\t\t\tx = ${rx}\n\t\t\ty = ${ry}\n\t\t\tz = ${rz}\n\t\t}\n\t}\n}\nchassis\n{\n\tchain\n\t{\n\t\tpos\n\t\t{\n\t\t\tx = 0\n\t\t\ty = 0\n\t\t\tz = 0\n\t\t}\n\t\tengine\n\t\t{\n\t\t\tx = ${ex}\n\t\t\ty = 0.467\n\t\t\tz = -0.109\n\t\t}\n\t\taxis = u\n\t\tratio = 1\n\t}\n}\n`;
const both=(a,b)=>a+'cockpit\n{\n'+b+'}\n';
const text=both(lineup('-0.34','0.26','-0.02','0.34','0.26','-0.02'),lineup('-0.3','0.23.5','0','0.3','0.2','0'));

test('typing coalesces into one undo step and equal values drop out of the draft',async()=>{
  const {Draft}=await load(),d=new Draft(CFG,{text});
  for(const v of ['-0.3','-0.35','-0.355'])d.edit('steer.leftgrip.pos.x',v,{typing:true});
  assert.equal(d.undoStack.length,1);d.endTyping();d.edit('steer.leftgrip.pos.x','-0.36',{typing:true});assert.equal(d.undoStack.length,2);
  d.undo();assert.equal(d.value('steer.leftgrip.pos.x'),'-0.355');d.undo();assert.equal(d.value('steer.leftgrip.pos.x'),'-0.34');assert.deepEqual(d.edits,{});
  d.redo();d.redo();assert.equal(d.value('steer.leftgrip.pos.x'),'-0.36');
  d.edit('steer.leftgrip.pos.x','-0.34');assert.ok(!('steer.leftgrip.pos.x' in d.edits));
  assert.equal(d.edit('steer.leftgrip.type','1'),false);
});

test('duplicated decimals are only suggested, then applied as one undoable step',async()=>{
  const {Draft}=await load(),d=new Draft(CFG,{text});
  const r=d.repairs();assert.deepEqual(r.map(x=>[x.path,x.from,x.to]),[['cockpit.steer.leftgrip.pos.y','0.23.5','0.235']]);
  assert.deepEqual(d.edits,{});assert.ok(r[0].line>30);
  d.saveMode='separate';assert.ok(d.issues().some(i=>i.path==='cockpit.steer.leftgrip.pos.y'&&i.suggestion==='0.235'));
  d.applyRepairs(['cockpit.steer.leftgrip.pos.y']);assert.equal(d.value('cockpit.steer.leftgrip.pos.y'),'0.235');assert.equal(d.issues().length,0);
  d.undo();assert.equal(d.value('cockpit.steer.leftgrip.pos.y'),'0.23.5');
});

test('both-view save mirrors the current view and reports every invalid source field',async()=>{
  const {Draft}=await load(),d=new Draft(CFG,{text});
  d.view='external';d.edit('steer.leftgrip.pos.y','0.27');
  const eff=d.effectiveEdits();assert.equal(eff['cockpit.steer.leftgrip.pos.y'],'0.27');assert.equal(eff['cockpit.steer.leftgrip.pos.x'],'-0.34');
  assert.equal(d.issues().length,0); // the cockpit typo is overwritten by the source view
  const ch=d.changes();assert.ok(ch.some(c=>c.fields.some(f=>f.path==='cockpit.steer.leftgrip.pos.y'&&f.mirrored)));
  assert.ok(ch.some(c=>c.fields.some(f=>f.path==='steer.leftgrip.pos.y'&&!f.mirrored)));
  d.view='cockpit';const issues=d.issues();assert.equal(issues.length,1);assert.equal(issues[0].path,'cockpit.steer.leftgrip.pos.y');assert.equal(issues[0].suggestion,'0.235');
  d.saveMode='separate';assert.equal(d.output(),CFG.patch(d.doc,{'steer.leftgrip.pos.y':'0.27'}).replace('0.23.5','0.23.5'));
});

test('mirror, transfer, reset and symmetry',async()=>{
  const {Draft}=await load(),d=new Draft(CFG,{text});
  assert.deepEqual(d.symmetry('external'),{width:0.68,centre:0,dy:0,dz:0,symmetric:true});
  d.edit('steer.leftgrip.pos.x','-0.35');d.edit('steer.leftgrip.pos.z','-0.025');
  const s=d.symmetry('external');assert.ok(Math.abs(s.centre+0.005)<1e-12&&!s.symmetric);
  const steps=d.undoStack.length;d.mirror('external','leftgrip');assert.equal(d.undoStack.length,steps+1);
  assert.deepEqual(['x','y','z'].map(a=>d.value('steer.rightgrip.pos.'+a)),['0.35','0.26','-0.025']);assert.ok(d.symmetry('external').symmetric);
  d.transfer('external','chain');assert.equal(d.value('cockpit.chassis.chain.engine.x'),'-0.074');
  d.edit('cockpit.chassis.chain.engine.x','-0.08');d.reset('cockpit','chain');assert.ok(!Object.keys(d.edits).some(p=>p.startsWith('cockpit.chassis.chain')));
  assert.equal(d.mirrorTargets('cockpit','leftgrip'),null); // invalid cockpit Y blocks mirroring
  const rows=d.compare();assert.ok(rows.find(r=>r.part==='leftgrip'&&r.suffix==='pos.x').delta>0);assert.equal(rows.length,14);
});

test('nudge uses fixed precision and line diff finds edits',async()=>{
  const {Draft,diffLines,formatNumber}=await load(),d=new Draft(CFG,{text});
  d.nudge('steer.leftgrip.pos.x',0.001);assert.equal(d.value('steer.leftgrip.pos.x'),'-0.339');
  d.nudge('steer.leftgrip.pos.x',-0.0001);assert.equal(d.value('steer.leftgrip.pos.x'),'-0.3391');
  assert.equal(formatNumber(1e-9),'0');assert.equal(formatNumber(0.1+0.2),'0.3');
  const diff=diffLines('a\nb\nc\nd','a\nB\nc\nd\ne');assert.deepEqual(diff.ops.filter(o=>o.type!=='same').map(o=>o.type+o.text),['delB'.replace('B','b'),'addB','adde']);
  assert.ok(diffLines('x\r\ny','x\ny').same);
});

test('symmetric hands: linked edits mirror X, copy Y/Z, and undo as one step',async()=>{
  const {Draft,handPartner}=await load(),d=new Draft(CFG,{text});
  assert.deepEqual(handPartner('cockpit.steer.rightgrip.pos.x'),{path:'cockpit.steer.leftgrip.pos.x',axis:'x'});
  assert.equal(handPartner('chassis.chain.engine.x'),null);
  assert.ok(d.canLink('external'));
  // half-typed input leaves the partner alone, then syncs once valid; one undo step
  for(const v of ['-','-0.','-0.42'])d.edit('steer.leftgrip.pos.x',v,{typing:true,linked:true});
  assert.equal(d.value('steer.rightgrip.pos.x'),'0.42');assert.equal(d.undoStack.length,1);
  d.endTyping();d.nudge('steer.rightgrip.pos.y',0.01,{linked:true});
  assert.equal(d.value('steer.leftgrip.pos.y'),'0.27');assert.equal(d.value('steer.rightgrip.pos.y'),'0.27');
  d.edit('steer.leftgrip.pos.z','-0.03',{linked:true});assert.equal(d.value('steer.rightgrip.pos.z'),'-0.03');
  assert.ok(d.symmetry('external').symmetric);
  d.undo();assert.equal(d.value('steer.rightgrip.pos.z'),'-0.02');assert.equal(d.value('steer.leftgrip.pos.z'),'-0.02');
  // assignLinked (gizmo drags) and multi-part reset/transfer
  d.assignLinked('steer.rightgrip.pos.x','0.5');assert.equal(d.value('steer.leftgrip.pos.x'),'-0.5');
  d.transfer('external',['leftgrip','rightgrip']);assert.equal(d.value('cockpit.steer.leftgrip.pos.x'),'-0.5');assert.equal(d.value('cockpit.steer.rightgrip.pos.x'),'0.5');
  d.reset('cockpit',['leftgrip','rightgrip']);assert.ok(!Object.keys(d.edits).some(p=>p.startsWith('cockpit.')));
  // unlinked edits stay independent
  d.edit('steer.leftgrip.pos.y','0.3');assert.equal(d.value('steer.rightgrip.pos.y'),'0.27');
  assert.ok(!new Draft(CFG,{text:lineup('-0.3','0.2','0','0.3','0.2','0').replace(/\trightgrip[\s\S]*?\n\t\}\n/,'')}).canLink('external'));
});
