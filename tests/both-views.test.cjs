const {test}=require('node:test'),assert=require('node:assert/strict'),CFG=require('../src/core/cfg-core.js');
const text='steer\n{\nleftgrip\n{\npos\n{\nx = -0.34\ny = 0.26\nz = -0.02\n}\n}\n}\ncockpit\n{\nsteer\n{\nleftgrip\n{\npos\n{\nx = -0.3\ny = 0.2\nz = 0\n}\n}\n}\n}\n';
test('both-view save mirrors pending edits from either source without changing source drafts',()=>{
 const doc=CFG.parse(text),edits={'steer.leftgrip.pos.y':'0.275'},before={...edits};
 const both=CFG.matchViews(doc,edits,'external'),result=CFG.parse(CFG.patch(doc,both));assert.deepEqual(edits,before);
 for(const axis of ['x','y','z'])assert.equal(result.fields.get('steer.leftgrip.pos.'+axis).value,result.fields.get('cockpit.steer.leftgrip.pos.'+axis).value);
 assert.equal(result.fields.get('cockpit.steer.leftgrip.pos.y').value,'0.275');
 const reverse=CFG.parse(CFG.patch(doc,CFG.matchViews(doc,{},'cockpit')));assert.equal(reverse.fields.get('steer.leftgrip.pos.y').value,'0.2');
 assert.throws(()=>CFG.matchViews(doc,{'steer.leftgrip.pos.y':'bad'},'external'),/Correct/);
 assert.throws(()=>CFG.matchViews(CFG.parse(text.split('cockpit')[0]),{},'external'),/matching field/);
});
