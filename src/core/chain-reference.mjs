import * as T from 'three';

// Static alignment guide, not the game's generated chain mesh. Rear axle
// positions are template rsusp coordinates; engine is a chassis CFG point.
export function chainEndpoints(reference,rearMatrix,engine,fraction=.5,rearX=reference.rearX){
  if(!engine?.every(Number.isFinite)||!Number.isFinite(fraction)||!Number.isFinite(rearX))return null;
  const rear=new T.Vector3(...reference.axleMin).lerp(new T.Vector3(...reference.axleMax),T.MathUtils.clamp(fraction,0,1));
  rear.x=rearX;rear.applyMatrix4(rearMatrix);
  return {front:new T.Vector3(...engine),rear};
}
export function chainTangents(front,rear,frontRadius,rearRadius){
  const d=new T.Vector2(rear.y-front.y,rear.z-front.z),length=d.length();
  if(!Number.isFinite(length)||frontRadius<=0||rearRadius<=0||length<=Math.abs(rearRadius-frontRadius))return [];
  const u=d.divideScalar(length),v=new T.Vector2(-u.y,u.x),c=(frontRadius-rearRadius)/length,s=Math.sqrt(1-c*c);
  return [-1,1].map(sign=>{const n=u.clone().multiplyScalar(c).addScaledVector(v,s*sign);return [front.clone().add(new T.Vector3(0,n.x*frontRadius,n.y*frontRadius)),rear.clone().add(new T.Vector3(0,n.x*rearRadius,n.y*rearRadius))];});
}
export function buildChainGuide(endpoints){
 const group=new T.Group();group.name='chain-alignment-guide';
 for(const [center,color,name]of [[endpoints.front,0xef9677,'Chain engine point'],[endpoints.rear,0xefbb6c,'Template rear axle']]){
 const marker=new T.Mesh(new T.SphereGeometry(center===endpoints.front?.002:.008,16,10),new T.MeshBasicMaterial({color}));marker.position.copy(center);marker.name=name;group.add(marker);
 }
 const geometry=new T.BufferGeometry().setFromPoints([endpoints.front,endpoints.rear]);const line=new T.Line(geometry,new T.LineDashedMaterial({color:0xd3a762,dashSize:.015,gapSize:.012}));line.computeLineDistances();group.add(line);
 group.userData.endpoints=endpoints;return group;
}
