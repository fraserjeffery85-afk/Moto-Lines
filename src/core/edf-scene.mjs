import * as THREE from 'three';
// Packed positions and parent matrices only: no reorientation, recentering or scaling.
export function buildEDF(data){
  const built=new Map();
  for(const item of data.parts){
    const group=new THREE.Group();group.name=item.name;
    const nodes=item.nodes.map(n=>{const o=new THREE.Group();o.name=n.name;o.matrixAutoUpdate=false;o.matrix.set(...n.matrix);
      for(const draw of n.groups){
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(item.positions.slice(draw.firstVertex*3,(draw.firstVertex+draw.vertexCount)*3)),3));
        const index=new Uint32Array(item.indices.slice(draw.firstTriangle*3,(draw.firstTriangle+draw.triangleCount)*3));for(let i=0;i<index.length;i++)index[i]-=draw.firstVertex;
        geometry.setIndex(new THREE.BufferAttribute(index,1));geometry.computeVertexNormals();geometry.computeBoundingSphere();
        const grip=/grip/i.test(n.name),body=/seat/i.test(n.name);const material=new THREE.MeshStandardMaterial({color:grip?0x424d55:body?0x4d5b61:0x9ba8b2,roughness:grip?.95:.64,metalness:grip?0:.28,side:THREE.DoubleSide});
        const mesh=new THREE.Mesh(geometry,material);mesh.name=n.name;o.add(mesh);
      }return o;});
    item.nodes.forEach((n,i)=>n.children.forEach(c=>nodes[i].add(nodes[c])));group.add(nodes[0]);built.set(item.name,group);
  }return built;
}
