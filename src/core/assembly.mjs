import {Matrix4} from 'three';

// Blender's authored world frame is converted to the editor's X/right,
// Y/up, Z/forward frame during extraction. Cancel only the exported root;
// retain every EDF child matrix and vertex, including export differences.
export function assemblyMatrix(part,profile){
  const rows=profile?.parts?.[part.name]?.assembledRoot;
  if(!Array.isArray(rows)||rows.length!==4||rows.some(r=>!Array.isArray(r)||r.length!==4||r.some(v=>!Number.isFinite(v))))throw Error('Invalid assembly reference for '+part.name);
  const authored=new Matrix4().set(...rows.flat());
  if(Math.abs(authored.determinant()-1)>.00001)throw Error('Assembly reference must preserve scale and handedness.');
  const packed=part.children[0].matrix.clone();
  if(Math.abs(packed.determinant())<.00001)throw Error('Invalid packed component root.');
  return authored.multiply(packed.invert());
}
