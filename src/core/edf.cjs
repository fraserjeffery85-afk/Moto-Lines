'use strict';
// Experimental reader for the observed EDF/EXT variant. No texture decoding.
// Every count, range, face index, node graph and matrix is checked before display.
function decodeEDF(buffer) {
  const b=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
  const check=(p,n=4)=>{if(!Number.isSafeInteger(p)||p<0||p+n>b.length) throw Error('Truncated EDF data');};
  const u=p=>{check(p);return b.readUInt32LE(p);};
  const floats=(p,n,limit=1e6)=>{check(p,n*4);const a=new Float32Array(n);for(let i=0;i<n;i++){a[i]=b.readFloatLE(p+i*4);if(!Number.isFinite(a[i])||Math.abs(a[i])>limit) throw Error('Unsupported EDF float data');}return a;};
  const name=p=>{check(p,100);const end=b.indexOf(0,p);if(end<p||end>=p+100)throw Error('Invalid EDF node name');return b.toString('utf8',p,end);};
  if(b.toString('ascii',0,4)!=='EDF\0'||b.toString('ascii',b.length-8,b.length-4)!=='EXT\0') throw Error('This EDF has a protected or unsupported container. It cannot be decoded by Moto Lines. Use an unprotected EDF export or an FBX/GLB source model.');
  const dir=b.length-u(b.length-4); check(dir,8); const textureStart=u(dir), count=u(dir+4);
  if(count>64||dir+8+count*104!==b.length-8) throw Error('Unsupported EDF directory');
  const parts=[{name:'chassis',start:4}];
  for(let i=0;i<count;i++) parts.push({name:name(dir+8+i*104),start:u(dir+108+i*104)});
  const result=[];let totalVertices=0,totalTriangles=0;
  for(const part of parts) {
    let p=part.start; const bounds=Array.from(floats(p,6,Infinity)); p+=24;
    const materials=u(p); if(materials>256)throw Error('Unsupported EDF materials');p+=4+56*materials;
    const vc=u(p);p+=4;if(!vc||vc>2000000)throw Error('Unsupported EDF vertex count');
    const positions=floats(p,vc*3);p+=72*vc;
    const tc=u(p);p+=4;if(tc>4000000)throw Error('Unsupported EDF face count');check(p,tc*12);
    const indices=new Uint32Array(tc*3);for(let k=0;k<indices.length;k++){indices[k]=u(p+k*4);if(indices[k]>=vc)throw Error('EDF face references an invalid vertex');}p+=tc*12;
    const nc=u(p);p+=4;if(!nc||nc>4096)throw Error('Unsupported EDF node count');const nodes=[];
    for(let j=0;j<nc;j++) {
      const label=name(p), matrix=Array.from(floats(p+104,16));
      if(Math.abs(matrix[12])+Math.abs(matrix[13])+Math.abs(matrix[14])>1e-4||Math.abs(matrix[15]-1)>1e-4)throw Error('Unsupported EDF transform');
      let q=p+236,cc=u(q);q+=4;if(cc>nc)throw Error('Invalid EDF child count');const children=[];
      for(let k=0;k<cc;k++){const child=u(q);if(child>=nc)throw Error('Invalid EDF child');children.push(child);q+=4;}
      const gc=u(q);q+=4;if(gc>1024)throw Error('Unsupported EDF draw groups');const groups=[];
      for(let k=0;k<gc;k++) {check(q,24);const g=Array.from({length:6},(_,x)=>u(q+x*4));q+=24;
        if(g[2]+g[3]>tc||g[4]+g[5]>vc)throw Error('Invalid EDF draw range');
        for(let f=g[2]*3;f<(g[2]+g[3])*3;f++)if(indices[f]<g[4]||indices[f]>=g[4]+g[5])throw Error('Unsupported EDF vertex ownership');
        groups.push({material:g[1],firstTriangle:g[2],triangleCount:g[3],firstVertex:g[4],vertexCount:g[5]});
      }
      const vertexCount=u(q),firstVertex=u(q+4);q+=8;if(firstVertex+vertexCount>vc)throw Error('Invalid EDF node range');
      // Static bounds may contain finite FLT_MAX empty-box sentinels.
      // Shape-animation nodes carry a track header, key count, and keys
      // containing 40 bytes per vertex plus a 4-byte key value.
      const flags=u(p+100);
      if(flags&65536){const tracks=u(q),keys=u(q+4);if(tracks!==1||!keys||keys>4096)throw Error('Unsupported EDF shape animation');const bytes=8+keys*(40*vertexCount+4);check(q,bytes);q+=bytes;}
      const nodeBounds=Array.from(floats(q,6,Infinity));q+=24;
      nodes.push({name:label,matrix,children,groups,vertexCount,firstVertex,bounds:nodeBounds});p=q;
    }
    const seen=new Set();function visit(i){if(seen.has(i))throw Error('Unsupported EDF node graph');seen.add(i);nodes[i].children.forEach(visit);}visit(0);
    if(seen.size!==nc)throw Error('Unconnected EDF nodes');
    if(part.name==='chassis'&&p!==textureStart)throw Error('Unexpected EDF mesh boundary');
    result.push({name:part.name,bounds,positions,indices,nodes}); totalVertices+=vc;totalTriangles+=tc;
  }
  return {parts:result,totalVertices,totalTriangles,experimental:true};
}
module.exports={decodeEDF};
