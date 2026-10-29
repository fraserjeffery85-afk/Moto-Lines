const {test}=require('node:test'),assert=require('node:assert/strict');
test('chain guide places rear axle in assembled suspension space and constructs external tangents',async()=>{
 const T=await import('three'),{chainEndpoints,chainTangents}=await import('../src/core/chain-reference.mjs');
 const reference={axleMin:[0,0,-.55],axleMax:[0,0,-.57],rearX:-.074};
 const m=new T.Matrix4().makeRotationX(.2);m.setPosition(0,.45,-.197);
 const e=chainEndpoints(reference,m,[-.074,.467,-.109],.5);
 assert.ok(e.rear.distanceTo(new T.Vector3(-.074,0,-.56).applyMatrix4(m))<1e-12);
 const tangents=chainTangents(e.front,e.rear,.035,.13);assert.equal(tangents.length,2);
 for(const [a,b]of tangents){assert.ok(Math.abs(a.distanceTo(e.front)-.035)<1e-12);assert.ok(Math.abs(b.distanceTo(e.rear)-.13)<1e-12);assert.ok(Math.abs(a.clone().sub(e.front).dot(b.clone().sub(a)))<1e-12);}
 assert.equal(chainEndpoints(reference,m,[NaN,0,0]),null);
 assert.deepEqual(chainTangents(new T.Vector3(),new T.Vector3(0,.01,0),.035,.13),[]);
});

test('reference guide draws exact endpoints without invented sprocket wrap and preserves large Z',async()=>{const T=await import('three'),{chainEndpoints,buildChainGuide}=await import('../src/core/chain-reference.mjs');const e=chainEndpoints({axleMin:[0,0,0],axleMax:[0,0,1],rearX:0},new T.Matrix4(),[0,0,5]);assert.equal(e.front.z,5);const g=buildChainGuide(e);assert.equal(g.children.length,3);assert.ok(g.children[2].isLine);assert.deepEqual(Array.from(g.children[2].geometry.attributes.position.array),[0,0,5,0,0,.5]);});
