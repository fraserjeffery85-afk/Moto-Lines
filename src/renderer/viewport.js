// Three.js viewport. Coordinate behaviour is carried over unchanged from Moto
// Lines 0.8.4: CFG values stay component-local; in assembly mode one shared
// parent matrix places the component, its markers, the rider hands and the
// gizmo target, so dragging a tilted local axis edits local CFG values.
import {buildEDF} from '../core/edf-scene.mjs';
import {assemblyMatrix} from '../core/assembly.mjs';
import {chainEndpoints,buildChainGuide} from '../core/chain-reference.mjs';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {TGALoader} from 'three/addons/loaders/TGALoader.js';

export const COLORS={leftgrip:0x8fe3b4,rightgrip:0x84b8f5,engine:0xf29a5c,rear:0xe9c46a};
const BG='#16191d';

export function createViewport(container,hooks={}){
  const scene=new THREE.Scene();scene.background=new THREE.Color(BG);
  const camera=new THREE.PerspectiveCamera(40,1,.001,10000);camera.position.set(.85,.65,1.4);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(BG);
  container.prepend(renderer.domElement);
  const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.target.set(0,.6,0);
  scene.add(new THREE.HemisphereLight(0xdfe8f2,0x2a2f35,2.1));
  const key=new THREE.DirectionalLight(0xfff6e8,2.8);key.position.set(3,5,4);scene.add(key);
  const rim=new THREE.DirectionalLight(0x9fc4ff,1.5);rim.position.set(-3,2,-3);scene.add(rim);
  const grid=new THREE.GridHelper(4,40,0x3a424b,0x252b31);scene.add(grid);
  // Game frame. MX Bikes data is X right / Y up / Z forward (left grip and chain
  // at negative X). Three.js is right-handed, so drawing those numbers directly
  // shows a mirror image (as Moto Lines 0.8.4 did). One view-only reflection on
  // this group restores the game's left and right. Everything inside keeps raw
  // CFG/EDF coordinates; no value is ever changed by this.
  const world=new THREE.Group();world.name='game-frame';scene.add(world);
  const origin=new THREE.AxesHelper(.15);world.add(origin);
  const markerRoot=new THREE.Group();markerRoot.matrixAutoUpdate=false;world.add(markerRoot);
  const bikeRoot=new THREE.Group();world.add(bikeRoot);
  world.scale.x=-1;
  function setGameHanded(on){world.scale.x=on?-1:1;world.updateMatrixWorld(true);if(last)update(last);}
  // Directions given in game coordinates (e.g. [-1,0,0] = the bike's left side).
  const displayDir=d=>new THREE.Vector3(d[0]*world.scale.x,d[1],d[2]);

  const markers={};
  for(const name of ['leftgrip','rightgrip','engine']){
    const m=new THREE.Mesh(new THREE.SphereGeometry(name==='engine'?.002:.009,20,14),new THREE.MeshBasicMaterial({color:COLORS[name],depthTest:false,transparent:true}));
    m.renderOrder=10;m.userData.lineup=name;markerRoot.add(m);markers[name]=m;
  }
  // Ghost of the saved (opened) position of the selected point.
  const ghost=new THREE.Group();ghost.renderOrder=9;markerRoot.add(ghost);
  const ghostBall=new THREE.Mesh(new THREE.SphereGeometry(1,16,10),new THREE.MeshBasicMaterial({color:0xf2f4f5,wireframe:true,transparent:true,opacity:.55,depthTest:false}));ghost.add(ghostBall);
  const ghostLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineDashedMaterial({color:0xf2f4f5,dashSize:.004,gapSize:.003,transparent:true,opacity:.7,depthTest:false}));
  ghostLine.renderOrder=9;markerRoot.add(ghostLine);

  const target=new THREE.Object3D();markerRoot.add(target);
  const gizmo=new TransformControls(camera,renderer.domElement);gizmo.setMode('translate');gizmo.setSpace('local');gizmo.setTranslationSnap(.001);gizmo.setSize(.8);scene.add(gizmo.getHelper());
  let updating=false;
  gizmo.addEventListener('dragging-changed',e=>{orbit.enabled=!e.value;if(e.value)hooks.onDragStart?.();else hooks.onDragEnd?.();});
  gizmo.addEventListener('objectChange',()=>{if(!updating)hooks.onDragMove?.(target.position.toArray());});

  // Pick a marker with a click (not a drag).
  const raycaster=new THREE.Raycaster();let pointerDown=null;
  renderer.domElement.addEventListener('pointerdown',e=>{pointerDown={x:e.clientX,y:e.clientY};});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!pointerDown||Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)>3||gizmo.axis)return;
    const r=renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
    const hit=raycaster.intersectObjects(Object.values(markers).filter(m=>m.visible))[0];
    if(hit)hooks.onPick?.(hit.object.userData.lineup);
  });

  let parts=new Map(),modelKind=null,sourceRoot=null,activeModel=null,assembly=null,presentation={assembled:false,parent:'steer',units:1,sourcePart:null};
  let handMeshes={},chainGuide=null,chainStatus='',last=null;
  const assembled=()=>modelKind==='edf'&&!!assembly&&presentation.assembled;

  function dispose(root){root.traverse(o=>{o.geometry?.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];for(const m of ms)if(m){for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose();}});}

  async function loadSource(data){
    let warning='';const manager=new THREE.LoadingManager();manager.addHandler(/\.tga$/i,new TGALoader(manager));
    manager.onError=()=>{warning='Some source textures are unavailable; geometry is still usable.';};
    manager.setURLModifier(url=>{if(/^(?:data:|blob:|model:\/\/preview\/)/.test(url))return url;if(/^https?:/i.test(url))throw Error('Remote model dependencies are disabled. Use local assets.');return 'model://preview/'+url.replace(/^[A-Za-z]:[\\/]/,'').replaceAll('\\','/').split('/').map(encodeURIComponent).join('/');});
    const bytes=new Uint8Array(data.bytes),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    let root;
    if(data.kind==='fbx')root=new FBXLoader(manager).parse(buffer,'model://preview/');
    else if(data.kind==='obj')root=new OBJLoader(manager).parse(new TextDecoder().decode(bytes));
    else root=(await new GLTFLoader(manager).parseAsync(data.kind==='gltf'?new TextDecoder().decode(bytes):buffer,'model://preview/')).scene;
    return {root,warning:()=>warning};
  }

  async function loadModel(data){
    let nextParts=null,nextSource=null,warning=null;
    if(data.kind==='edf')nextParts=buildEDF(data);else{const s=await loadSource(data);nextSource=s.root;warning=s.warning;}
    for(const m of parts.values()){m.removeFromParent();dispose(m);}parts.clear();
    if(activeModel&&modelKind!=='edf'){activeModel.removeFromParent();dispose(activeModel);}activeModel=null;
    if(sourceRoot)dispose(sourceRoot);sourceRoot=nextSource;modelKind=data.kind;if(nextParts)parts=nextParts;
    assembly=data.assembly||null;
    const sources=[];
    if(sourceRoot){sourceRoot.updateMatrixWorld(true);sourceRoot.traverse(o=>{if(o===sourceRoot||o.name)sources.push({label:o===sourceRoot?'Whole source scene':o.name,uuid:o.uuid});});}
    return {sources,warning:warning?.()||'',findSource:name=>sourceRoot?.getObjectByName(name)?.uuid||null};
  }

  function present(next,frame=true){
    presentation={...presentation,...next};
    for(const mesh of parts.values())mesh.removeFromParent();
    if(activeModel&&modelKind!=='edf'){activeModel.removeFromParent();dispose(activeModel);}activeModel=null;
    if(modelKind==='edf'){
      for(const group of parts.values()){group.matrixAutoUpdate=false;group.matrix.copy(assembled()&&assembly.parts[group.name]?assemblyMatrix(group,assembly):new THREE.Matrix4());}
      if(assembled()){for(const group of parts.values())if(assembly.parts[group.name])bikeRoot.add(group);activeModel=bikeRoot;}
      else activeModel=parts.get(presentation.parent)||null;
    }else if(sourceRoot){
      const source=sourceRoot.getObjectByProperty('uuid',presentation.sourcePart)||sourceRoot;
      activeModel=source.clone(true);
      activeModel.traverse(o=>{if(o.geometry)o.geometry=o.geometry.clone();if(o.material){const clone=m=>{const c=m.clone();for(const [k,v] of Object.entries(c))if(v?.isTexture)c[k]=v.clone();return c;};o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);}});
      const matrix=source.matrix.clone();activeModel.matrixAutoUpdate=true;activeModel.position.set(0,0,0);activeModel.quaternion.identity();activeModel.scale.set(1,1,1);
      // Selecting a component removes its placement in the source scene; children keep theirs.
      if(source===sourceRoot)activeModel.applyMatrix4(matrix);
      const wrapper=new THREE.Group();wrapper.scale.setScalar(Number(presentation.units)||1);wrapper.add(activeModel);activeModel=wrapper;
    }
    if(activeModel){if(activeModel!==bikeRoot)world.add(activeModel);setWire(wireOn);if(frame)frameModel();}
    if(last)update(last);
  }

  let wireOn=false;
  function setWire(on){wireOn=on;activeModel?.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.wireframe=on;});}
  function setGrid(on){grid.visible=origin.visible=on;}
  function setSnap(step){gizmo.setTranslationSnap(step||null);}

  function setHands(data){
    const next={};
    for(const [side,info] of Object.entries(data.hands)){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(info.positions),3));g.setIndex(new THREE.BufferAttribute(new Uint32Array(info.indices),1));g.computeVertexNormals();
      const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:side==='left'?COLORS.leftgrip:COLORS.rightgrip,roughness:.85,metalness:0,side:THREE.DoubleSide}));
      m.name=side+'-rider-hand-reference';next[side+'grip']=m;
    }
    for(const m of Object.values(handMeshes)){m.removeFromParent();dispose(m);}
    handMeshes=next;Object.values(handMeshes).forEach(m=>markerRoot.add(m));
    if(last)update(last);
  }

  // s: {view, part, point, coords(base), originalCoords(base), base(view,part), showMarkers, showGhost,
  //     showHands, handOpacity, alignment(view,key), busy, chain:{fraction,rearX}}
  function update(s){
    last=s;updating=true;
    const parent=s.part==='chain'?'chassis':'steer';
    markerRoot.matrix.copy(assembled()&&parts.has(parent)?parts.get(parent).matrix:new THREE.Matrix4());world.updateMatrixWorld(true);
    const selectedBase=s.base(s.view,s.part)+'.'+(s.part==='chain'?s.point:'pos');
    for(const name of Object.keys(markers)){
      const chain=name==='engine',v=s.coords(s.base(s.view,chain?'chain':name)+'.'+(chain?'engine':'pos')),m=markers[name];
      m.visible=s.showMarkers&&!!v&&(chain===(s.part==='chain'));if(v)m.position.fromArray(v);
      const selected=chain?(s.part==='chain'&&s.point==='engine'):s.part===name;m.scale.setScalar(selected?1.35:1);m.material.opacity=selected?1:.7;
    }
    const v=s.coords(selectedBase),o=s.originalCoords(selectedBase);
    const moved=v&&o&&Math.hypot(v[0]-o[0],v[1]-o[1],v[2]-o[2])>1e-7;
    const showGhost=s.showGhost&&s.showMarkers&&moved&&!(s.part==='chain'&&s.point==='pos');
    ghost.visible=ghostLine.visible=!!showGhost;
    if(showGhost){ghost.position.fromArray(o);ghostBall.scale.setScalar(s.part==='chain'?.0035:.011);ghostLine.geometry.setFromPoints([new THREE.Vector3(...o),new THREE.Vector3(...v)]);ghostLine.computeLineDistances();}
    if(v&&s.showMarkers&&!s.busy&&!(s.part==='chain'&&s.point==='pos')){target.position.fromArray(v);gizmo.attach(target);}else gizmo.detach();
    for(const [key,mesh] of Object.entries(handMeshes)){
      const p=s.coords(s.base(s.view,key)+'.pos'),a=s.alignment(s.view,key);
      mesh.visible=s.showHands&&s.part!=='chain'&&!!p;
      if(p){mesh.position.fromArray(p).add(new THREE.Vector3(...a.offset));mesh.rotation.set(...a.rotation.map(THREE.MathUtils.degToRad));}
      const opacity=s.handOpacity/100,transparent=opacity<1;mesh.material.opacity=opacity;
      if(mesh.material.transparent!==transparent){mesh.material.transparent=transparent;mesh.material.needsUpdate=true;}mesh.material.depthWrite=!transparent;
    }
    updateChain(s);updating=false;
  }
  function chainAvailable(){return assembled()&&!!assembly?.chainReference&&parts.has('chassis')&&parts.has('rsusp');}
  function updateChain(s){
    if(chainGuide){chainGuide.removeFromParent();dispose(chainGuide);chainGuide=null;}chainStatus='';
    if(s.part!=='chain'||!chainAvailable())return;
    const engine=s.coords(s.base(s.view,'chain')+'.engine'),r=assembly.chainReference;
    if(!engine){chainStatus='Enter a valid chain end to show the guide.';return;}
    const front=new THREE.Vector3(...engine).applyMatrix4(parts.get('chassis').matrix);
    const endpoints=chainEndpoints(r,parts.get('rsusp').matrix,front.toArray(),s.chain.fraction,s.chain.rearX);
    if(!endpoints){chainStatus='Enter a valid rear reference position.';return;}
    chainGuide=buildChainGuide(endpoints);world.add(chainGuide);
    chainStatus={distance:endpoints.front.distanceTo(endpoints.rear)*1000,lateral:Math.abs(endpoints.front.x-endpoints.rear.x)*1000};
  }

  function aim(center,dir,distance){orbit.target.copy(center);camera.position.copy(center).add(dir.clone().normalize().multiplyScalar(distance));orbit.update();}
  function frameModel(){
    world.updateMatrixWorld(true);
    const box=activeModel?new THREE.Box3().setFromObject(activeModel):new THREE.Box3(new THREE.Vector3(-.5,.1,-.8),new THREE.Vector3(.5,1.2,.8));if(box.isEmpty())return;
    const center=box.getCenter(new THREE.Vector3()),size=Math.max(box.getSize(new THREE.Vector3()).length(),.15);
    camera.near=Math.max(.0001,size/10000);camera.far=Math.max(100,size*100);camera.updateProjectionMatrix();
    aim(center,new THREE.Vector3(.8,.45,1.3),size*1.25);
  }
  function worldOf(local){world.updateMatrixWorld(true);return markerRoot.localToWorld(new THREE.Vector3(...local));}
  function framePoint(local){if(!local)return;const p=worldOf(local);aim(p,camera.position.clone().sub(orbit.target),.3);}
  function frameChain(){
    if(!chainGuide)return frameModel();world.updateMatrixWorld(true);
    const {front,rear}=chainGuide.userData.endpoints,center=world.localToWorld(front.clone().add(rear).multiplyScalar(.5));
    aim(center,displayDir([-1,.12,.12]),Math.max(.8,front.distanceTo(rear)*2.7)); // from the chain (left) side
  }
  // Rider: from behind and above the seat, looking down the bars.
  function frameRider(left,right){
    if(!left||!right)return false;const l=worldOf(left),r=worldOf(right),mid=l.clone().add(r).multiplyScalar(.5);
    aim(mid,new THREE.Vector3(0,.55,-.8),Math.max(.7,l.distanceTo(r)*1.7));return true;
  }
  function preset(dir){const d=Math.max(.1,camera.position.distanceTo(orbit.target));aim(orbit.target.clone(),displayDir(dir),d);}

  new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;if(w&&h){renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}}).observe(container);
  renderer.domElement.addEventListener('pointermove',e=>{
    if(gizmo.dragging)return;const r=renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
    renderer.domElement.style.cursor=raycaster.intersectObjects(Object.values(markers).filter(m=>m.visible)).length?'pointer':'';
  });
  renderer.setAnimationLoop(()=>{orbit.update();renderer.render(scene,camera);});

  return {
    loadModel,present,update,setHands,setWire,setGrid,setSnap,frameModel,framePoint,frameChain,frameRider,preset,setGameHanded,
    get gameHanded(){return world.scale.x<0;},
    get modelKind(){return modelKind;},get assembly(){return assembly;},get assembled(){return assembled();},
    get hasModel(){return !!activeModel;},get chainAvailable(){return chainAvailable();},get chainStatus(){return chainStatus;},
    get handsLoaded(){return Object.keys(handMeshes).length===2;},
    // Test aid: screen position (NDC) of a point in game coordinates, or of a marker.
    project(gamePoint){world.updateMatrixWorld(true);camera.updateMatrixWorld();const v=world.localToWorld(new THREE.Vector3(...gamePoint)).project(camera);return {x:v.x,y:v.y};},
    markerScreen(name){const m=markers[name];if(!m?.visible)return null;world.updateMatrixWorld(true);camera.updateMatrixWorld();const v=m.getWorldPosition(new THREE.Vector3()).project(camera);return {x:v.x,y:v.y};},
    packedRootMatrix(name){const g=parts.get(name);return g?g.children[0].matrix.elements:null;},
    get partCount(){return parts.size;}
  };
}
