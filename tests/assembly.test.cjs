const {test}=require('node:test'),assert=require('node:assert/strict');
test('Blender assembly restores the authored steering axis and keeps CFG edits local',async()=>{
 const T=await import('three'),{assemblyMatrix}=await import('../src/core/assembly.mjs');
 const profile=require('../src/core/assembly.json');const part=new T.Group();part.name='steer';const packed=new T.Group();packed.matrixAutoUpdate=false;packed.matrix.set(-1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1);part.add(packed);
 for(const name of ['chassis','steer','fsusp','rsusp']){
   const original=profile.templateReference.checks[name].blenderWorld.flat();
   assert.ok(Math.max(...profile.parts[name].blenderWorld.flat().map((v,i)=>Math.abs(v-original[i])))<1e-6,'Husqvarna component must match the supplied MXB template: '+name);
 }
 const matrix=assemblyMatrix(part,profile),origin=new T.Vector3().applyMatrix4(matrix);
 assert.ok(origin.distanceTo(new T.Vector3(0,.995297372341156,.344514548778534))<1e-10);
 const axis=new T.Vector3(0,1,0).transformDirection(matrix);
 assert.ok(Math.abs(T.MathUtils.radToDeg(Math.atan2(-axis.z,axis.y))-26.5)<.001);
 for(const p of [[-.34,.26,-.02],[.34,.26,-.02],[0,0,0]]){
   const local=new T.Vector3(...p),world=local.clone().applyMatrix4(matrix),returned=world.clone().applyMatrix4(matrix.clone().invert());assert.ok(local.distanceTo(returned)<1e-12);
   const moved=local.clone().add(new T.Vector3(0,.001,0)).applyMatrix4(matrix).sub(world);assert.ok(moved.clone().normalize().distanceTo(axis)<1e-10);assert.ok(Math.abs(moved.length()-.001)<1e-9);
 }
 assert.throws(()=>assemblyMatrix(part,{parts:{steer:{assembledRoot:[[1,0,0,0]]}}}),/Invalid/);
 assert.throws(()=>assemblyMatrix(part,{parts:{steer:{assembledRoot:[[2,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}}}),/preserve scale/);
});
