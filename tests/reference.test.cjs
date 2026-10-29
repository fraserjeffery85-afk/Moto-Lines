const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {extractHands}=require('../src/core/hands.cjs');
test('unreadable rider / animation files fail closed',()=>{assert.throws(()=>extractHands(Buffer.from('locked'),Buffer.alloc(0)));});
if(process.env.DGS_TEST_EDF)test('rendered EDF coordinates equal the packed matrix hierarchy for every vertex',async()=>{
 const data=require('../src/core/edf.cjs').decodeEDF(await fs.readFile(process.env.DGS_TEST_EDF));const {buildEDF}=await import('../src/core/edf-scene.mjs');const roots=buildEDF(data);
 const multiply=(a,b)=>Array.from({length:16},(_,k)=>{const r=Math.floor(k/4),c=k%4;let n=0;for(let j=0;j<4;j++)n+=a[r*4+j]*b[j*4+c];return n;});
 const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];let checked=0;
 for(const part of data.parts){const root=roots.get(part.name);assert.deepEqual(root.position.toArray(),[0,0,0]);assert.deepEqual(root.scale.toArray(),[1,1,1]);assert.deepEqual(root.quaternion.toArray(),[0,0,0,1]);root.updateMatrixWorld(true);
  function walk(i,parent,obj){const n=part.nodes[i],expected=multiply(parent,n.matrix);let meshIndex=0;
   for(const draw of n.groups){const mesh=obj.children[meshIndex++],local=mesh.geometry.attributes.position.array,world=mesh.matrixWorld.elements;
    for(let j=0;j<16;j++)assert.ok(Math.abs(world[(j%4)*4+Math.floor(j/4)]-expected[j])<1e-8,'Packed matrix differs: '+n.name);
    for(let v=0;v<draw.vertexCount;v++){const at=(draw.firstVertex+v)*3;for(let axis=0;axis<3;axis++)assert.equal(local[v*3+axis],part.positions[at+axis]);checked++;}
   }
   n.children.forEach((child,j)=>walk(child,expected,obj.children[n.groups.length+j]));
  }walk(0,identity,root.children[0]);
 }
 assert.equal(checked,129543);
});
if(process.env.DGS_TEST_RIDER&&process.env.DGS_TEST_ANM)test('actual glove references have valid geometry at physical hand scale',async()=>{
 const r=await fs.readFile(process.env.DGS_TEST_RIDER),a=await fs.readFile(process.env.DGS_TEST_ANM),cfg=await fs.readFile(require('node:path').join(require('node:path').dirname(process.env.DGS_TEST_RIDER),'gfx.cfg'),'utf8'),before=Buffer.from(r);const result=extractHands(r,a,cfg);assert.deepEqual(r,before);assert.equal(result.frame,24);
 for(const hand of Object.values(result.hands)){assert.ok(hand.positions.length>2000);assert.ok(hand.indices.length>4000);for(const v of hand.positions)assert.ok(Number.isFinite(v));for(const i of hand.indices)assert.ok(i<hand.positions.length/3);for(const n of hand.size)assert.ok(n>.025&&n<.3);}
 assert.deepEqual(result.hands.left.anchor,[.08,-.02,.02]);assert.deepEqual(result.hands.right.anchor,[.08,.02,.02]);
});
if(process.env.DGS_TEST_RIDER&&process.env.DGS_TEST_ANM)test('unchanged stock index joint agrees between EDF bind matrix and ANM rotation',async()=>{
 const {readRider,readPose}=require('../src/core/hands.cjs');const r=readRider(await fs.readFile(process.env.DGS_TEST_RIDER)),a=readPose(await fs.readFile(process.env.DGS_TEST_ANM));
 const name='riderRIG_LeftIndex2',bind=r.nodes.find(n=>n.name===name).matrix.elements,pose=a.pose.get(name).elements;
 for(const i of [0,1,2,4,5,6,8,9,10])assert.ok(Math.abs(bind[i]-pose[i])<.001,'ANM rotation does not match the unchanged joint: '+i);
});
