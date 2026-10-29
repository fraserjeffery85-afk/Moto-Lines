import {Draft,PARTS,VIEW_LABEL,PART_LABEL,formatNumber,diffLines} from './state.js';
import {createViewport,COLORS} from './viewport.js';

const $=id=>document.getElementById(id),API=window.desktop,CFG=window.CFG;
const STEPS=[0.0001,0.001,0.01];
const blankHand=()=>({offset:[0,0,0],rotation:[0,0,0]});
const blankAlignment=()=>({external:{leftgrip:blankHand(),rightgrip:blankHand()},cockpit:{leftgrip:blankHand(),rightgrip:blankHand()}});

let draft=null,view='external',part='leftgrip',point='pos',busy=false,handBusy=false,dragBefore=null;
let prefs={saveMode:'auto',step:0.001,showHands:true,handOpacity:100,grid:true,wire:false,helpers:true,snap:true,ghost:true,linkHands:false,gameHanded:true,drawer:'changes',drawerOpen:false};
let genericNoticeHidden=false,alignment=blankAlignment(),handData=null,modelData=null,sourceFinder=null,modelCfg=null,boot=null,lastDirty=null,backupCache=null;

// ---------- small helpers
function h(tag,props={},...children){
  const el=document.createElement(tag);
  for(const [k,v] of Object.entries(props||{})){
    if(v==null||v===false)continue;
    if(k==='class')el.className=v;else if(k==='text')el.textContent=v;else if(k.startsWith('on'))el.addEventListener(k.slice(2),v);
    else if(k==='dataset')Object.assign(el.dataset,v);else if(k==='style')el.style.cssText=v; // CSSOM: allowed by the CSP
    else if(k==='checked')el.checked=!!v;else el.setAttribute(k,v===true?'':v);
  }
  for(const c of children.flat())if(c!=null&&c!==false)el.append(c.nodeType?c:String(c));
  return el;
}
const status=text=>{$('status').textContent=text;};
function message(title,text){$('messageTitle').textContent=title;$('messageText').textContent=text;if(!$('message').open)$('message').showModal();}
const fail=e=>{console.error(e);const msg=e?.message||String(e);message('That didn’t work',msg.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));status(msg.split('\n')[0]);};
const otherView=v=>v==='external'?'cockpit':'external';
const parentFor=()=>part==='chain'?'chassis':'steer';
const base=(v=view,p=part)=>CFG.base(v,p);
const pointBase=()=>base()+'.'+(part==='chain'?point:'pos');
// Symmetric hands: active for grip edits when both grips exist in this view.
const linked=()=>!!prefs.linkHands&&part!=='chain'&&!!draft?.canLink(view);
const handTargets=()=>linked()?['leftgrip','rightgrip']:part;
const value=path=>draft?.value(path);
const coords=b=>draft?draft.coords(b):null;
const signed=(n,d=3)=>(n<0?'−':n>0?'+':'')+Math.abs(n).toFixed(d);
const plain=(n,d=3)=>(n<0?'−':'')+Math.abs(n).toFixed(d);
let prefTimer=null,pendingPrefs={};
function savePref(patch){Object.assign(prefs,patch);Object.assign(pendingPrefs,patch);clearTimeout(prefTimer);prefTimer=setTimeout(()=>{API.setPrefs(pendingPrefs).catch(()=>{});pendingPrefs={};},250);}
function syncDraftMode(){if(draft){draft.view=view;draft.saveMode=prefs.saveMode;}}

// ---------- viewport
const viewportHooks={
  onDragStart:()=>{if(draft)dragBefore=draft.snapshot();},
  onDragMove:xyz=>{if(!draft)return;['x','y','z'].forEach((a,i)=>(linked()?draft.assignLinked(pointBase()+'.'+a,formatNumber(xyz[i])):draft.assign(pointBase()+'.'+a,formatNumber(xyz[i]))));render(false);},
  onDragEnd:()=>{if(draft&&dragBefore){draft.pushUndo(dragBefore);dragBefore=null;render();}},
  onPick:name=>{selectPart(name==='engine'?'chain':name,name==='engine'?'engine':'pos');}
};
// If WebGL can't start (old driver, remote desktop), keep every non-3D feature working.
let vp,viewportError=null;
try{vp=createViewport($('viewport'),viewportHooks);}
catch(e){
  console.error(e);viewportError=e;const noop=()=>{};
  vp={loadModel:async()=>({sources:[],warning:'',findSource:()=>null}),present:noop,update:noop,setHands:noop,setWire:noop,setGrid:noop,setSnap:noop,
    frameModel:noop,framePoint:noop,frameChain:noop,frameRider:noop,preset:noop,setGameHanded:noop,modelKind:null,assembly:null,assembled:false,hasModel:false,
    chainAvailable:false,chainStatus:'',handsLoaded:false,packedRootMatrix:()=>null,partCount:0};
}
function viewportState(){
  return {view,part,point,base:CFG.base,coords,originalCoords:b=>draft?draft.originalCoords(b):null,
    showMarkers:prefs.helpers,showGhost:prefs.ghost,showHands:prefs.showHands,handOpacity:prefs.handOpacity,
    alignment:(v,k)=>alignment[v][k],busy,chain:{fraction:Number($('rearAxle').value)/100,rearX:Number($('rearPlane').value)}};
}

// ---------- coordinate editor
const xyz={};
for(const axis of ['x','y','z']){
  const input=h('input',{type:'text',inputmode:'decimal',spellcheck:'false',id:'pos-'+axis,'aria-label':axis.toUpperCase()+' position'});
  input.addEventListener('input',()=>{if(draft&&draft.edit(pointBase()+'.'+axis,input.value.trim(),{typing:true,linked:linked()}))render(false);});
  input.addEventListener('blur',()=>{draft?.endTyping();render(false);});
  input.addEventListener('keydown',e=>{
    if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();nudge(axis,(e.key==='ArrowUp'?1:-1)*(e.shiftKey?10:1));input.select();}
    else if(e.key==='Enter'){input.blur();}
    else if(e.key==='Escape'){draft?.endTyping();input.value=value(pointBase()+'.'+axis)??'';input.blur();}
  });
  const minus=h('button',{text:'−',title:`${axis.toUpperCase()} minus one step`,onclick:()=>nudge(axis,-1)});
  const plus=h('button',{text:'+',title:`${axis.toUpperCase()} plus one step`,onclick:()=>nudge(axis,1)});
  const was=h('div',{class:'was'});
  $('xyz').append(h('div',{class:'coord'},h('b',{text:axis.toUpperCase()}),input,minus,plus,was));
  xyz[axis]={input,minus,plus,was};
}
function nudge(axis,steps){if(!draft||busy)return;if(draft.nudge(pointBase()+'.'+axis,steps*prefs.step,{linked:linked()}))render();}

// ---------- rendering
function render(rebuild=true){
  syncDraftMode();
  const isChain=part==='chain',issues=draft?draft.issues():[];
  // plate
  document.documentElement.style.setProperty('--plate-color',`var(--${isChain?'chain':part==='leftgrip'?'left':'right'})`);
  $('partTitle').textContent=PART_LABEL[part];$('fieldPath').textContent=pointBase();$('viewTag').textContent=VIEW_LABEL[view]+(linked()?' · both hands':'');
  $('partDescription').textContent=isChain?(point==='engine'?'Where the chain meets the engine sprocket, in chassis space. The dashed line runs to the template rear axle as a reference; it isn’t the game’s chain.':'Raw chain mesh offset. Saved to the CFG but not drawn: it isn’t a sprocket centre.'):'Grip position in steering-component space. Drag the arrows, type a value or nudge with the buttons.';
  $('chainTabs').hidden=!isChain;$('chainSettings').hidden=!isChain;
  $('chainGuideOptions').hidden=!isChain||!vp.chainAvailable;
  $('handCalibration').hidden=isChain;$('mirror').hidden=isChain;
  for(const v of ['external','cockpit'])$(v).classList.toggle('active',view===v);
  document.querySelectorAll('[data-point]').forEach(b=>b.classList.toggle('active',b.dataset.point===point));
  document.querySelectorAll('[data-step]').forEach(b=>b.classList.toggle('active',Number(b.dataset.step)===prefs.step));
  // coordinates
  for(const axis of ['x','y','z']){
    const p=pointBase()+'.'+axis,v=value(p),f=xyz[axis],has=!!draft?.has(p);
    if(document.activeElement!==f.input||rebuild)f.input.value=v??'';
    f.input.disabled=!has||busy;f.input.placeholder=draft&&!has?'missing':'';
    const bad=v!==undefined&&!CFG.numeric(v);f.input.classList.toggle('invalid',bad);
    f.minus.disabled=f.plus.disabled=f.input.disabled||bad;
    const o=draft?.original(p);f.was.replaceChildren();f.was.classList.remove('moved');
    if(bad){const fix=CFG.repairNumeric(v);f.was.append(fix?'Not a number.':'Not a valid number.');if(fix)f.was.append(h('button',{text:'Use '+fix,onclick:()=>{draft.applyRepairs([p]);render();}}));}
    else if(has&&o!==undefined&&String(o)!==String(v)){f.was.classList.add('moved');f.was.textContent=`was ${o}`+(CFG.numeric(o)?`  (${signed(Number(v)-Number(o),4)})`:'');}
  }
  for(const k of ['axis','ratio']){
    const p=base()+'.'+k,el=$(k),v=value(p);
    if(k==='axis'&&v!==undefined&&![...el.options].some(o=>o.value===v))el.add(new Option(v+' (unrecognised)',v));
    if(document.activeElement!==el||rebuild)el.value=v??'';el.disabled=!isChain||!draft?.has(p)||busy;
    el.classList.toggle('invalid',v!==undefined&&!CFG.valid(p,v));
  }
  // lineup list
  for(const p of PARTS){
    const b=document.querySelector(`[data-part="${p}"]`),c=coords(base(view,p)+'.'+(p==='chain'?'engine':'pos'));
    b.classList.toggle('active',p===part);b.classList.toggle('changed',!!draft?.partChanged(view,p));
    const exists=!!draft?.doc.blocks.has(base(view,p));b.classList.toggle('problem',!!draft&&exists&&!c);
    $('vals-'+p).textContent=!draft?'—':!exists?'Not in this file':c?c.map(n=>plain(n)).join('  '):'Check values';
  }
  // validation
  const box=$('validation');box.replaceChildren();
  if(!draft)box.append(h('p',{class:'muted small',text:'Open a GFX to check its lineups.'}));
  else if(!issues.length)box.append(h('div',{class:'good',text:'Every hand and chain field is valid.'}));
  for(const issue of issues){
    const row=h('div',{class:'issue'},h('code',{text:issue.path}),h('div',{text:issue.message}));
    const actions=h('div');
    if(draft?.has(issue.path))actions.append(h('button',{class:'quiet small',text:'Go to field',onclick:()=>goToField(issue.path)}));
    if(issue.suggestion)actions.append(h('button',{class:'fix',text:'Use '+issue.suggestion,onclick:()=>{draft.applyRepairs([issue.path]);render();status(`Changed ${issue.path} to ${issue.suggestion} in the draft.`);}}));
    if(actions.children.length)row.append(actions);box.append(row);
  }
  if(draft&&!draft.doc.blocks.has(base()))box.append(h('div',{class:'issue',text:`This file has no ${VIEW_LABEL[view].toLowerCase()} ${PART_LABEL[part].toLowerCase()} section. Fields are never added, so there’s nothing to edit here.`}));
  // actions
  const count=draft?draft.changedCount():0,blocked=issues.length>0;
  $('save').disabled=$('saveAs').disabled=!draft||blocked||busy;$('saveBoth').disabled=!draft||busy;
  $('save').title=blocked?'Fix the values listed under File check first':'';
  $('reset').disabled=!draft||busy||![].concat(handTargets()).some(p=>draft.partChanged(view,p));
  $('reset').textContent=linked()?'Reset both':'Reset';
  $('undo').disabled=!draft?.undoStack.length||busy;$('redo').disabled=!draft?.redoStack.length||busy;
  $('focusPoint').disabled=!coords(pointBase());
  const other=part==='leftgrip'?'right':'left';$('mirror').textContent='Mirror to '+other;
  $('mirror').disabled=busy||!draft||isChain||linked()||!draft.mirrorTargets(view,part);$('mirror').title=linked()?'Hands are linked: they already move together':'Copy this hand to the other side, mirrored across the bar centre (X → −X)';
  $('transfer').textContent='Copy to '+VIEW_LABEL[otherView(view)].toLowerCase();
  $('transfer').disabled=busy||![].concat(handTargets()).every(p=>draft?.transferTargets(view,p));
  if(linked())$('transfer').textContent='Copy both to '+VIEW_LABEL[otherView(view)].toLowerCase();
  renderLink();
  // Unsaved = the user's own draft edits. Fields that saving will only mirror
  // into the other view are counted in the Changes tab, not here.
  const edited=draft?Object.keys(draft.edits).length:0;
  $('unsaved').hidden=!edited;$('unsaved').textContent=edited?`${edited} unsaved edit${edited===1?'':'s'}`:'';
  const dirty=edited>0;if(dirty!==lastDirty){lastDirty=dirty;API.dirty(dirty);}
  $('changeCount').textContent=count;$('changeCount').classList.toggle('hot',count>0);
  renderSaveMode();renderHandAlignment(rebuild);
  vp.update(viewportState());
  renderViewportChrome();renderHandStatus();renderDrawer();
  $('welcome').hidden=!!draft||vp.hasModel;
}
function renderSaveMode(){
  const src=prefs.saveMode==='auto'?view:prefs.saveMode;$('saveMode').value=prefs.saveMode;
  $('saveHelp').textContent=prefs.saveMode==='separate'?'Third person and cockpit keep their own values. Each view saves exactly what you set in it.':`Save copies every hand and chain lineup from ${VIEW_LABEL[src]} into both sections. Fields must already exist in both. Check Changes before saving.`;
  $('saveModeTag').textContent=prefs.saveMode==='separate'?'views separate':'both from '+VIEW_LABEL[src].toLowerCase();
  $('saveStatus').textContent=prefs.saveMode==='separate'?'Saving keeps views separate':'Saving writes both views from '+VIEW_LABEL[src];
}
function renderViewportChrome(){
  const parent=parentFor();
  $('spaceTitle').textContent=(parent==='steer'?'Steer':'Chassis')+' · '+(vp.assembled?'assembled bike':vp.modelKind==='edf'?'single component':vp.hasModel?'source model':'no model');
  const note=$('viewportNote');note.classList.remove('verify');
  if(viewportError){note.textContent='3D preview couldn’t start on this computer (WebGL unavailable). Editing, checking and saving still work.';note.classList.add('verify');}
  else if(!vp.hasModel)note.textContent=draft?'No model loaded. Markers show CFG positions.':'';
  else if(vp.modelKind==='edf'){
    if(vp.assembled&&vp.assembly.match==='template'){note.textContent='Placed with the MXB template. Check this model’s placement in game.';note.classList.add('verify');}
    else note.textContent=vp.assembled?'Placement verified against the original Husqvarna scene.':'Single component view: assembly placement is off.';
  }else{note.textContent='Source model: check units and the selected component against the EDF.';note.classList.add('verify');}
  const sel=value(pointBase()+'.y');if(sel!==undefined&&!CFG.numeric(sel))note.textContent+=' The selected point has an invalid value, so its marker is hidden.';
  renderCallout();
  // legend
  const legend=$('legend');legend.replaceChildren();
  const items=part==='chain'?[['Chain end · CFG',COLORS.engine],['Rear axle · template',COLORS.rear]]:[['Left grip',COLORS.leftgrip],['Right grip',COLORS.rightgrip]];
  const now=coords(pointBase()),was=draft?.originalCoords(pointBase());
  if(prefs.ghost&&prefs.helpers&&now&&was&&now.some((n,i)=>Math.abs(n-was[i])>1e-7)&&!(part==='chain'&&point==='pos'))items.push(['Saved position',0xf2f4f5]);
  for(const [label,c] of items)legend.append(h('span',{},h('i',{style:`background:#${c.toString(16).padStart(6,'0')}`}),label));
  // HUD
  const hud=$('hud');hud.replaceChildren();hud.hidden=true;
  if(draft&&part!=='chain'){
    const s=draft.symmetry(view);
    if(s){hud.hidden=false;const mm=n=>(n*1000).toFixed(1);
      hud.append(h('div',{class:'state'+(s.symmetric?'':' off')},(s.symmetric?'Symmetric':'Not symmetric')+(linked()?' · linked':'')),
        ...[['Grip spread',mm(s.width)+' mm'],['Centre offset',signed(s.centre*1000,1)+' mm'],['Height difference',signed(s.dy*1000,1)+' mm'],['Reach difference',signed(s.dz*1000,1)+' mm']].map(([t,v])=>h('div',{},h('dt',{text:t}),h('dd',{text:v}))));}
  }else if(draft&&part==='chain'&&vp.chainAvailable){
    const st=vp.chainStatus;
    if(st&&typeof st==='object'){hud.hidden=false;hud.append(h('div',{},h('dt',{text:'Chain end to rear axle'}),h('dd',{text:st.distance.toFixed(1)+' mm'})),h('div',{},h('dt',{text:'Sideways mismatch'}),h('dd',{text:st.lateral.toFixed(1)+' mm'})));}
  }
  const st=vp.chainStatus;$('chainGuideStatus').textContent=typeof st==='string'?st:st?`Chain end to rear axle: ${st.distance.toFixed(1)} mm\nSideways mismatch: ${st.lateral.toFixed(1)} mm`:'';
  $('chainGuideStatus').style.whiteSpace='pre-line';
  // accuracy
  $('accuracy').textContent=vp.assembled?(vp.assembly.match==='template'?'This EDF is shown using the MXB template positions. Its own Blender placement hasn’t been checked.':'Bike placement checked against your Husqvarna scene and the original MXB template.')+' Static pose: suspension and rider IK aren’t simulated.':vp.hasModel?'Component-local coordinates only. Full bike placement is unavailable or switched off.':'Open a model to see how it’s placed.';
  const m=vp.packedRootMatrix(parent);
  $('packedMatrix').textContent=m?'Stored root matrix ('+parent+'):\n'+Array.from({length:4},(_,r)=>Array.from({length:4},(_,c)=>m[c*4+r].toFixed(6).padStart(10)).join(' ')).join('\n')+(vp.assembled?'\n\nAssembly transform applied outside the EDF.\nVertices and child matrices unchanged.':'\n\nNo geometry correction. Scale 1.'):'';
  $('frame').title=vp.assembled?'Frame bike (F)':'Frame component (F)';
  $('riderCam').disabled=!(coords(base(view,'leftgrip')+'.pos')&&coords(base(view,'rightgrip')+'.pos'));
}
// Explains, in the viewport, why the gloves aren't visible and offers the fix.
function renderCallout(){
  const call=$('callout');call.replaceChildren();call.hidden=true;
  if(viewportError||part==='chain'||!prefs.showHands||!(draft||vp.hasModel))return;
  if(vp.handsLoaded&&handData?.generic&&!genericNoticeHidden){
    call.hidden=false;
    call.append(h('span',{text:'Showing generic gloves. Load your MX Bikes rider.pkz for the exact stock glove.'}),
      h('button',{class:'primary',text:'Load rider.pkz…',onclick:()=>openHands({choose:true})}),
      h('button',{class:'quiet',text:'Hide','aria-label':'Hide this notice',onclick:()=>{genericNoticeHidden=true;renderCallout();}}));
  }
  if(!vp.handsLoaded){
    call.hidden=false;
    if(handBusy){call.append(h('span',{text:'Loading the rider’s hands…'}));return;}
    call.append(h('span',{text:'Rider hands aren’t loaded. Choose rider.pkz from your MX Bikes folder.'}),h('button',{class:'primary',text:'Load rider hands…',onclick:()=>openHands()}));
    return;
  }
  if(!draft)return;
  for(const key of ['leftgrip','rightgrip']){
    const b=base(view,key)+'.pos',axis=['x','y','z'].find(a=>!CFG.numeric(value(b+'.'+a)??''));if(!axis)continue;
    const path=b+'.'+axis,v=value(path),fix=v===undefined?null:CFG.repairNumeric(v);
    call.replaceChildren();call.hidden=false; // a hidden hand matters more than the generic-glove note
    call.append(h('span',{},`${key==='leftgrip'?'Left':'Right'} hand hidden: `,h('code',{text:path}),v===undefined?' is missing.':` is ${v}.`));
    if(fix)call.append(h('button',{class:'primary',text:'Use '+fix,onclick:()=>{draft.applyRepairs([path]);render();status(`Changed ${path} to ${fix} in the draft.`);}}));
    else if(v!==undefined)call.append(h('button',{text:'Go to field',onclick:()=>goToField(path)}));
    return;
  }
}
function renderHandStatus(){
  const list=$('handVisibility');list.replaceChildren();let anyBad=false;
  for(const key of ['leftgrip','rightgrip']){
    const label=key==='leftgrip'?'Left':'Right',b=base(view,key)+'.pos';
    const bad=draft?['x','y','z'].filter(a=>!CFG.numeric(value(b+'.'+a)??'')):[];
    let text,cls='';
    if(!vp.handsLoaded)text=label+': not loaded';
    else if(!draft)text=label+': loaded';
    else if(bad.length){text=`${label}: hidden, ${bad.map(a=>a.toUpperCase()+' is '+(value(b+'.'+a)??'missing')).join(', ')}`;cls='bad';anyBad=true;}
    else if(part==='chain'){text=label+': hidden while editing the chain';}
    else if(!prefs.showHands){text=label+': switched off';}
    else{text=label+': shown'+(handData?.generic?' (generic glove)':'');cls='ok';}
    list.append(h('li',{class:cls,text}));
  }
  $('fixHandFields').hidden=!anyBad;
  $('loadHands').textContent=handData?.generic?'Load MX Bikes rider.pkz':vp.handsLoaded?'Reload rider hands':'Load rider hands';
}
function renderHandAlignment(rebuild){
  if(part==='chain')return;
  document.querySelectorAll('[data-hand-kind]').forEach(input=>{
    const v=alignment[view][part][input.dataset.handKind][Number(input.dataset.handAxis)];
    if(document.activeElement!==input||rebuild)input.value=v;input.disabled=!handData;
  });
}

// ---------- drawer
function renderDrawer(){
  // With nothing open the drawer stays collapsed so the welcome screen has room.
  const open=prefs.drawerOpen&&!!draft;$('drawer').classList.toggle('open',open);document.body.classList.toggle('idle',!draft);$('toggleDrawer').textContent=open?'Hide':'Show';
  document.querySelectorAll('[data-tab]').forEach(t=>{t.classList.toggle('active',t.dataset.tab===prefs.drawer);t.setAttribute('aria-selected',t.dataset.tab===prefs.drawer);});
  document.querySelectorAll('[data-pane]').forEach(p=>p.hidden=p.dataset.pane!==prefs.drawer);
  if(!open)return;
  ({changes:renderChanges,output:renderOutput,compare:renderCompare,backups:renderBackups})[prefs.drawer]();
}
function renderChanges(){
  const pane=$('changesPane');pane.replaceChildren();
  if(!draft)return pane.append(h('p',{class:'empty',text:'Open a GFX to see changes here.'}));
  const {error}=draft.safeEffective(),changes=draft.changes();
  const src=draft.sourceView();
  pane.append(h('p',{class:'muted small'},src?`Saving copies ${VIEW_LABEL[src]} lineups into both views. Lines marked “from ${VIEW_LABEL[src]}” are copies.`:'Views are saved separately.'));
  if(error)pane.append(h('div',{class:'issue',text:error}));
  if(!changes.length)return pane.append(h('p',{class:'empty',text:'No changes yet. The file will be written exactly as it was opened.'}));
  for(const c of changes)pane.append(h('div',{class:'change'},h('span',{class:'ln',text:'Line '+c.line}),
    h('span',{class:'path'},c.fields.map(f=>f.path).join(', '),c.fields.some(f=>f.mirrored)?h('em',{text:`  from ${VIEW_LABEL[src]}`}):null),
    h('span',{class:'before',text:'− '+c.before.trim()}),h('span',{class:'after',text:'+ '+c.after.trim()})));
}
function renderOutput(){
  const pre=$('code');pre.replaceChildren();
  if(!draft){pre.textContent='Open a GFX to preview the exact output.';return;}
  const hits=new Set(draft.changes().map(c=>c.line)),lines=draft.output().split('\n'),frag=document.createDocumentFragment();
  lines.forEach((line,i)=>{const row=h('span',{class:hits.has(i+1)?'hit':null},h('span',{class:'ln',text:String(i+1)}),line.replace(/\r$/,''));frag.append(row,'\n');});
  pre.append(frag);
}
function renderCompare(){
  const pane=$('comparePane');pane.replaceChildren();
  if(!draft)return pane.append(h('p',{class:'empty',text:'Open a GFX to compare its third-person and cockpit lineups.'}));
  const rows=draft.compare();if(!rows.length)return pane.append(h('p',{class:'empty',text:'This file has no hand or chain lineups.'}));
  const body=h('tbody');let last=null;
  for(const r of rows){
    if(r.part!==last){last=r.part;body.append(h('tr',{class:'group'},h('td',{colspan:4,text:PART_LABEL[r.part]})));}
    const cell=(v,edited)=>h('td',{},v===undefined?h('span',{class:'muted',text:'missing'}):h('span',{class:edited?'edited':null,text:v}));
    body.append(h('tr',{},h('td',{class:'label',text:r.suffix}),cell(r.external,r.externalChanged),cell(r.cockpit,r.cockpitChanged),
      h('td',{class:r.same?'muted':'diff',text:r.same?'same':r.delta!=null?signed(r.delta,4):'differs'})));
  }
  pane.append(h('table',{},h('thead',{},h('tr',{},h('th',{text:'Field'}),h('th',{text:'Third person'}),h('th',{text:'Cockpit'}),h('th',{text:'Cockpit − third person'}))),body),
    h('p',{class:'muted small',text:'Draft values are shown; edited ones are highlighted.'}));
}
async function renderBackups(force=false){
  const pane=$('backupsPane');
  if(!draft){pane.replaceChildren(h('p',{class:'empty',text:'Open a GFX to see its recovery copies.'}));return;}
  if(!backupCache||force||backupCache.path!==draft.file.path){
    try{backupCache={path:draft.file.path,list:await API.listBackups()};}catch(e){pane.replaceChildren(h('div',{class:'issue',text:e.message}));return;}
  }
  if(prefs.drawer!=='backups')return;
  const list=backupCache.list;pane.replaceChildren();
  if(!list.length)return pane.append(h('p',{class:'empty',text:'No recovery copies yet. Each time you save over this file, the previous version is kept here.'}));
  const fmt=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'medium'}),diffBox=h('div',{class:'backupdiff',hidden:true});
  pane.append(h('p',{class:'muted small',text:'Copies of this file as it was before each save, newest first.'}),
    h('ul',{class:'backups'},list.map(b=>h('li',{},h('time',{text:'Before '+fmt.format(new Date(b.created))}),h('small',{text:(b.size/1024).toFixed(1)+' KB'}),
      h('button',{text:'Compare',onclick:()=>showBackupDiff(b,diffBox,fmt)}),h('button',{text:'Restore…',onclick:()=>restoreBackup(b.name)})))),diffBox);
}
async function showBackupDiff(b,box,fmt){
  try{
    const {text}=await API.readBackup(b.name),d=diffLines(text,draft.doc.text);box.hidden=false;box.replaceChildren();
    box.append(h('p',{class:'small',text:`Copy from before ${fmt.format(new Date(b.created))} compared with the file on disk (unsaved edits not included).`}));
    if(d.same)return box.append(h('p',{class:'empty',text:'Identical to the current file.'}));
    const keep=new Set();d.ops.forEach((o,i)=>{if(o.type!=='same')for(let k=i-2;k<=i+2;k++)keep.add(k);});
    const pre=h('pre');let gap=false;
    d.ops.forEach((o,i)=>{if(!keep.has(i)){if(!gap){pre.append(h('span',{class:'ctx',text:'  ⋯\n'}));gap=true;}return;}gap=false;
      pre.append(h('span',{class:o.type==='del'?'del':o.type==='add'?'add':'ctx',text:(o.type==='del'?'− ':o.type==='add'?'+ ':'  ')+o.text+'\n'}));});
    box.append(h('p',{class:'muted small',text:'− only in the copy   + only in the current file'}),pre);
  }catch(e){fail(e);}
}
async function restoreBackup(name){
  try{
    const result=await API.restoreBackup(name);if(!result)return;
    loadDraft(result,false);backupCache=null;status('Recovery copy restored. The file it replaced is now in Backups.');render();renderBackups(true);
  }catch(e){fail(e);}
}

// ---------- navigation
function selectPart(next,nextPoint){
  const prev=parentFor();part=next;point=nextPoint||(part==='chain'?'engine':'pos');
  if(prev!==parentFor()){
    if(modelData&&modelData.kind!=='edf'){const id=sourceFinder?.(parentFor());if(id)$('sourcePart').value=id;}
    presentModel(false);
  }
  render();if(part==='chain'&&vp.chainAvailable)vp.frameChain();
}
function setView(v){view=v;render();}
function goToField(path){
  const m=/^(cockpit\.)?(?:steer\.(leftgrip|rightgrip)\.pos\.([xyz])|chassis\.chain\.(?:(pos|engine)\.([xyz])|(axis|ratio)))$/.exec(path);if(!m)return;
  view=m[1]?'cockpit':'external';
  if(m[2])selectPart(m[2],'pos');else selectPart('chain',m[4]||point);
  const el=m[3]?xyz[m[3]].input:m[5]?xyz[m[5]].input:$(m[6]);
  el.scrollIntoView({block:'center'});el.focus();el.select?.();
}

// ---------- files
function loadDraft(file,checkRepairs=true){
  draft=new Draft(CFG,file);syncDraftMode();backupCache=null;
  $('cfgName').textContent=file.path.split(/[\\/]/).slice(-2).join(' / ');$('cfgPath').textContent=file.path;$('fileInfo').title=file.path;
  if(checkRepairs){const r=draft.repairs();if(r.length)showRepairs(r);return r.length;}
  return 0;
}
async function openCfg(file){
  try{const next=await API.openCfg(file);if(!next)return;const r=loadDraft(next);render();
    status(r?`Opened ${next.path}. ${r} possible typo${r===1?'':'s'} to review.`:`Opened ${next.path}. ${draft.issues().length?draft.issues().length+' value(s) need attention.':'All lineup fields are valid.'}`);
  }catch(e){fail(e);}
}
function showRepairs(list){
  const body=$('repairRows');body.replaceChildren();
  for(const r of list)body.append(h('tr',{},h('td',{},h('input',{type:'checkbox',checked:true,dataset:{path:r.path},'aria-label':'Apply to '+r.path})),
    h('td',{},h('code',{text:r.path}),h('div',{class:'muted small',text:'Line '+r.line})),h('td',{class:'from',text:r.from}),h('td',{class:'to',text:r.to})));
  $('repairHands').hidden=!list.some(r=>/grip\.pos\./.test(r.path));
  $('repairs').showModal();
}
$('repairApply').onclick=()=>{const paths=[...$('repairRows').querySelectorAll('input:checked')].map(i=>i.dataset.path);$('repairs').close();if(paths.length&&draft.applyRepairs(paths)){render();status(`Applied ${paths.length} suggestion${paths.length===1?'':'s'} to the draft. Review and save; Undo reverts them.`);}};
$('repairSkip').onclick=()=>{$('repairs').close();render();status('Values left as they are. Saving stays blocked until they’re valid.');};

async function save(saveAs=false,override=null){
  if(!draft||busy)return;const prev=prefs.saveMode;
  if(override){prefs.saveMode=override;syncDraftMode();}
  try{
    const issues=draft.issues();
    if(issues.length){message('Fix invalid values first','Saving is blocked until every hand and chain field holds a valid value. See File check in the right panel.');return;}
    const result=await API.save(draft.effectiveEdits(),saveAs);if(!result)return;
    loadDraft(result,false);status('Saved '+result.path+(result.backup?'. The previous version is in Backups.':'.'));
  }catch(e){fail(e);}
  finally{prefs.saveMode=prev;render();}
}
async function openModel(file){
  if(busy)return;busy=true;$('loading').hidden=false;$('model').disabled=true;render();status('Reading model geometry…');
  try{
    const data=await API.openModel(file);if(!data)return;
    const loaded=await vp.loadModel(data);modelData=data;sourceFinder=loaded.findSource;
    const assembly=data.assembly;$('assemblyOptions').hidden=!assembly;$('assemblyView').value=assembly?'assembled':'packed';
    $('assemblyView').options[0].textContent=assembly?.match==='template'?'Assembled (MXB template)':'Assembled bike';
    modelCfg=data.cfgPath||null;$('matchingCfg').hidden=!modelCfg;$('matchingCfg').title=modelCfg||'';
    if(assembly?.chainReference){$('rearAxle').value='50';$('rearPlane').value=assembly.chainReference.rearX;}
    $('modelName').textContent=data.name;$('modelName').title=data.path;
    $('modelInfo').textContent=data.kind==='edf'?`${data.parts.length} components · ${data.totalVertices.toLocaleString()} vertices · ${(data.size/1048576).toFixed(1)} MB`:`${data.kind.toUpperCase()} source · ${(data.size/1048576).toFixed(1)} MB`;
    const badge=$('modelBadge');badge.hidden=false;badge.className='badge'+(assembly?.match==='exact'?'':' verify');
    badge.textContent=assembly?(assembly.match==='template'?'MXB template placement':'Verified placement'):data.kind==='edf'?'Experimental EDF reader':'Check coordinates';
    $('sourceOptions').hidden=data.kind==='edf';
    if(data.kind!=='edf'){const sel=$('sourcePart');sel.replaceChildren(...loaded.sources.map(s=>new Option(s.label,s.uuid)));sel.value=loaded.findSource(parentFor())||loaded.sources[0]?.uuid;$('units').value=data.kind==='fbx'?'0.01':'1';}
    presentModel(true);
    status(loaded.warning||(assembly?'Bike assembled. Edits stay in component-local CFG coordinates.':'Model loaded. Edits use component-local coordinates.'));
    if(!draft&&modelCfg){busy=false;await openCfg(modelCfg);}
  }catch(e){fail(e);}
  finally{busy=false;$('loading').hidden=true;$('model').disabled=false;render();}
}
function presentModel(frame){
  if(!modelData)return;
  vp.present({assembled:$('assemblyView').value==='assembled',parent:parentFor(),units:Number($('units').value),sourcePart:$('sourcePart').value},frame);
}
async function openHands(files,{quiet=false}={}){
  if(handBusy)return;handBusy=true;$('loadHands').disabled=$('chooseRider').disabled=true;renderCallout();status('Reading the stock rider’s gloves and pose…');
  try{
    const data=await API.openHands(files);if(!data){status('Rider hands not loaded.');return;}
    if(!data.hands?.left||!data.hands?.right)throw Error('The rider reference must contain both hands.');
    vp.setHands(data);handData=data;
    $('handSource').textContent=data.generic?'Generic gloves that come with the app, for a quick preview. They’re close to the stock glove but not exact: load rider.pkz from MX Bikes for the real one (it’s remembered).'
      :(data.stock?'MX Bikes stock rider':data.rider.split(/[\\/]/).slice(-2).join(' / '))+`, animation frame ${data.frame}. Real glove mesh anchored by the rider CFG; in-game wrist orientation isn’t verified.`;
    $('handSource').title=data.rider+'\n'+data.animation;
    render();status('Rider hands loaded. Overlay alignment never changes the CFG.');
  }catch(e){if(quiet){status('Rider hands couldn’t load: '+(e.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}else fail(e);}
  finally{handBusy=false;$('loadHands').disabled=$('chooseRider').disabled=false;renderHandStatus();renderCallout();}
}

// ---------- hand overlay alignment inputs
for(const kind of ['offset','rotation'])for(let i=0;i<3;i++){
  const input=h('input',{type:'text',inputmode:'decimal',dataset:{handKind:kind,handAxis:i},id:`hand-${kind}-${i}`});
  input.addEventListener('input',()=>{if(part==='chain')return;const n=Number(input.value);if(input.value.trim()===''||!Number.isFinite(n))return;alignment[view][part][kind][i]=n;savePref({handAlignment:alignment});vp.update(viewportState());});
  $('handAdjustments').append(h('label',{},`${kind==='offset'?'Move':'Turn'} ${'XYZ'[i]} ${kind==='offset'?'(m)':'(°)'}`,input));
}
$('resetHand').onclick=()=>{if(part==='chain')return;alignment[view][part]=blankHand();savePref({handAlignment:alignment});render();};

// ---------- commands & events
const commands={
  open:()=>openCfg(),model:()=>openModel(),save:()=>save(),saveAs:()=>save(true),
  saveBoth:()=>{if(!draft||busy)return;$('bothSource').value=view;$('bothSave').showModal();},
  undo:()=>{if(document.activeElement?.tagName==='INPUT')document.activeElement.blur();if(draft?.undo())render();},
  redo:()=>{if(document.activeElement?.tagName==='INPUT')document.activeElement.blur();if(draft?.redo())render();},
  frame:()=>vp.frameModel(),drawer:()=>{savePref({drawerOpen:!prefs.drawerOpen});renderDrawer();},
  shortcuts:()=>$('shortcuts').showModal(),about:()=>$('about').showModal(),
  importLegacy:()=>importLegacy(),
  checkUpdates:()=>checkForUpdates()
};
API.onCommand(c=>{if(c.startsWith('openRecent:'))return openCfg(c.slice(11));commands[c]?.();});
$('open').onclick=$('welcomeOpen').onclick=()=>openCfg();$('model').onclick=$('welcomeModel').onclick=()=>openModel();
$('save').onclick=()=>save();$('saveAs').onclick=()=>save(true);$('saveBoth').onclick=commands.saveBoth;
$('bothCancel').onclick=()=>$('bothSave').close();
$('bothConfirm').onclick=async()=>{const src=$('bothSource').value;$('bothSave').close();await save(true,src);};
$('undo').onclick=commands.undo;$('redo').onclick=commands.redo;
$('messageClose').onclick=()=>$('message').close();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('external').onclick=()=>setView('external');$('cockpit').onclick=()=>setView('cockpit');
document.querySelectorAll('[data-part]').forEach(b=>b.onclick=()=>selectPart(b.dataset.part));
document.querySelectorAll('[data-point]').forEach(b=>b.onclick=()=>{point=b.dataset.point;render();});
document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>setStep(Number(b.dataset.step)));
function setStep(step){savePref({step});vp.setSnap(prefs.snap?step:null);render(false);status('Step size '+step);}
document.querySelectorAll('[data-tab]').forEach(t=>t.onclick=()=>{savePref({drawer:t.dataset.tab,drawerOpen:true});renderDrawer();});
$('toggleDrawer').onclick=commands.drawer;
$('axis').onchange=()=>{if(draft?.edit(base()+'.axis',$('axis').value))render();};
$('ratio').oninput=()=>{if(draft?.edit(base()+'.ratio',$('ratio').value.trim(),{typing:true}))render(false);};
$('ratio').onblur=()=>{draft?.endTyping();render(false);};
$('reset').onclick=()=>{draft?.reset(view,handTargets());render();status(`${linked()?'Both hands':PART_LABEL[part]} (${VIEW_LABEL[view]}) reset to the opened values.`);};
$('mirror').onclick=()=>{if(draft?.mirror(view,part)){render();status(`Mirrored ${PART_LABEL[part].toLowerCase()} to the ${part==='leftgrip'?'right':'left'} hand (X flipped, Y and Z kept).`);}};
$('transfer').onclick=()=>{if(draft?.transfer(view,handTargets())){render();status(`Copied ${linked()?'both hands':PART_LABEL[part].toLowerCase()} to ${VIEW_LABEL[otherView(view)]}.`);}};
function renderLink(){
  const row=$('linkRow'),box=$('linkHands'),fix=$('linkFix');
  row.hidden=part==='chain';box.checked=!!prefs.linkHands;
  const can=!!draft?.canLink(view);box.disabled=!draft||!can||busy;
  row.classList.toggle('on',linked());
  $('linkHelp').textContent=draft&&!can?`This view doesn’t have both grip positions, so the hands can’t be linked here.`:'Moving one hand moves the other as its mirror image: X flipped, Y and Z the same.';
  fix.hidden=true;
  if(!linked())return;
  const s=draft.symmetry(view);
  if(!s){fix.hidden=false;$('linkFixText').textContent='A hand value is invalid, so the hands can’t be matched yet. Fix it under File check.';$('matchFromLeft').hidden=$('matchFromRight').hidden=true;return;}
  if(s.symmetric)return;
  fix.hidden=false;$('matchFromLeft').hidden=$('matchFromRight').hidden=false;
  $('linkFixText').textContent=`The ${VIEW_LABEL[view].toLowerCase()} hands don’t match yet. Pick which hand to keep; edits already move both.`;
  $('matchFromLeft').disabled=!draft.mirrorTargets(view,'leftgrip');$('matchFromRight').disabled=!draft.mirrorTargets(view,'rightgrip');
}
function setLink(on){
  if(on&&!draft?.canLink(view))return;
  savePref({linkHands:on});render(false);
  const s=draft?.symmetry(view);
  status(on?(s&&!s.symmetric?'Hands linked. They don’t match yet: choose which hand to keep, or keep editing.':'Hands linked: moving one moves the other as its mirror image.'):'Hands unlinked: each hand moves on its own.');
}
$('linkHands').onchange=()=>setLink($('linkHands').checked);
$('matchFromLeft').onclick=()=>{if(draft?.mirror(view,'leftgrip')){render();status('Right hand now mirrors the left hand.');}};
$('matchFromRight').onclick=()=>{if(draft?.mirror(view,'rightgrip')){render();status('Left hand now mirrors the right hand.');}};
$('focusPoint').onclick=()=>part==='chain'&&vp.chainAvailable?vp.frameChain():vp.framePoint(coords(pointBase()));
$('focusChain').onclick=()=>vp.frameChain();$('frame').onclick=()=>vp.frameModel();
$('riderCam').onclick=()=>vp.frameRider(coords(base(view,'leftgrip')+'.pos'),coords(base(view,'rightgrip')+'.pos'));
const cams={front:[0,0,1],left:[-1,0,0],right:[1,0,0],top:[0,1,.0001]};
document.querySelectorAll('[data-cam]').forEach(b=>b.onclick=()=>vp.preset(cams[b.dataset.cam]));
$('matchingCfg').onclick=()=>{if(modelCfg)openCfg(modelCfg);};
$('assemblyView').onchange=()=>{presentModel(true);render();};
$('units').onchange=$('sourcePart').onchange=()=>{presentModel(true);render();};
$('rearAxle').oninput=()=>{vp.update(viewportState());renderViewportChrome();};
$('rearPlane').oninput=()=>{const ok=CFG.numeric($('rearPlane').value);$('rearPlane').classList.toggle('invalid',!ok);if(ok){vp.update(viewportState());renderViewportChrome();}};
$('loadHands').onclick=()=>openHands(handData?.generic?{choose:true}:undefined);$('chooseRider').onclick=()=>openHands({choose:true});
$('fixHandFields').onclick=()=>{for(const key of ['leftgrip','rightgrip']){const a=['x','y','z'].find(a=>!CFG.numeric(value(base(view,key)+'.pos.'+a)??''));if(a){goToField(base(view,key)+'.pos.'+a);return;}}};
$('saveMode').onchange=()=>{savePref({saveMode:$('saveMode').value});render();status(prefs.saveMode==='separate'?'Saving keeps third person and cockpit separate.':'Saving now writes both views from '+VIEW_LABEL[prefs.saveMode==='auto'?view:prefs.saveMode]+'.');};
$('openBackups').onclick=()=>API.openBackups().catch(fail);
$('copyCode').onclick=async()=>{if(!draft)return;try{await navigator.clipboard.writeText(draft.output());status('Output copied'+(draft.issues().length?' (it still contains invalid values).':'.'));}catch(e){fail(e);}};
for(const [id,key] of [['gameHanded','gameHanded'],['showHands','showHands'],['grid','grid'],['wire','wire'],['helpers','helpers'],['snap','snap'],['ghost','ghost']])
  $(id).onchange=()=>{savePref({[key]:$(id).checked});applyDisplayPrefs();render(false);};
$('handOpacity').oninput=()=>{savePref({handOpacity:Number($('handOpacity').value)});vp.update(viewportState());};
function applyDisplayPrefs(){vp.setGameHanded(prefs.gameHanded!==false);vp.setGrid(prefs.grid);vp.setWire(prefs.wire);vp.setSnap(prefs.snap?prefs.step:null);}

window.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]'))return;
  const t=document.activeElement?.tagName;if(['INPUT','SELECT','TEXTAREA'].includes(t))return;
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  const k=e.key,mult=e.shiftKey?10:1;
  const axisKeys={ArrowLeft:['x',-1],ArrowRight:['x',1],ArrowUp:['y',1],ArrowDown:['y',-1],PageUp:['z',1],PageDown:['z',-1]};
  if(axisKeys[k]&&draft&&!(part==='chain'&&point==='pos')){e.preventDefault();nudge(axisKeys[k][0],axisKeys[k][1]*mult);return;}
  if(k==='1')selectPart('leftgrip');else if(k==='2')selectPart('rightgrip');else if(k==='3')selectPart('chain');
  else if(k==='v'||k==='V')setView(otherView(view));
  else if(k==='f'||k==='F')vp.frameModel();
  else if(k==='g'||k==='G')$('focusPoint').click();
  else if(k==='m'||k==='M')$('mirror').click();
  else if((k==='l'||k==='L')&&part!=='chain'&&draft?.canLink(view))setLink(!prefs.linkHands);
  else if(k==='['||k===']'){const i=STEPS.indexOf(prefs.step);const n=STEPS[Math.max(0,Math.min(STEPS.length-1,i+(k===']'?1:-1)))];if(n!==prefs.step)setStep(n);}
  else if(k==='?')$('shortcuts').showModal();
  else return;
  e.preventDefault();
});
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',async e=>{e.preventDefault();if(busy)return;
  const files=[...e.dataTransfer.files].map(f=>API.filePath(f));
  for(const p of files.filter(p=>/\.(edf|fbx|glb|gltf|obj)$/i.test(p)))await openModel(p);
  for(const p of files.filter(p=>/\.cfg$/i.test(p)))await openCfg(p);
  for(const p of files.filter(p=>/\.pkz$/i.test(p)))await openHands({package:p});
});

// ---------- welcome, recents, migration
function renderRecent(list){
  const ul=$('recentList');ul.replaceChildren();$('recentWrap').hidden=!list.length;
  const rtf=new Intl.RelativeTimeFormat(undefined,{numeric:'auto'});
  const ago=iso=>{if(!iso)return '';const s=(Date.parse(iso)-Date.now())/1000;for(const [u,n] of [['year',31536e3],['month',2592e3],['week',604800],['day',86400],['hour',3600],['minute',60]])if(Math.abs(s)>=n)return rtf.format(Math.round(s/n),u);return 'just now';};
  for(const r of list){
    const parts=r.path.split(/[\\/]/),title=parts.slice(-2,-1)[0]||parts.at(-1);
    ul.append(h('li',{class:r.exists?null:'missing'},h('button',{title:r.exists?r.path:'Missing: click to remove from this list',onclick:async()=>{if(r.exists)openCfg(r.path);else{await API.forgetRecent('cfg',r.path);renderRecent(list.filter(x=>x!==r));}}},
      h('b',{text:title}),h('small',{text:r.path}),h('time',{text:r.exists?ago(r.openedAt):'missing'}))));
  }
}
function renderLegacy(found){
  const card=$('legacyCard');card.replaceChildren();if(!found?.length){card.hidden=true;return;}
  const l=found[0];card.hidden=false;
  card.append(h('p',{text:`Moto Lines ${l.version} is in the folder next to this one. Bring over its rider.pkz location${l.backupCount?` and ${l.backupCount} recovery cop${l.backupCount===1?'y':'ies'}`:''}? The old folder isn’t changed.`}),
    h('div',{},h('button',{class:'primary',text:'Import',onclick:()=>importLegacy(l.root)}),h('button',{class:'quiet',text:'Not now',onclick:()=>{API.dismissLegacy();card.hidden=true;}})));
}
async function importLegacy(folder){
  try{const r=await API.importLegacy(folder);if(!r)return;$('legacyCard').hidden=true;
    status(`Imported from Moto Lines ${r.version}: ${r.copied} recovery cop${r.copied===1?'y':'ies'}${r.skipped?`, ${r.skipped} already here`:''}${r.rider?', rider.pkz location':''}.`);
    if(r.rider&&!vp.handsLoaded)openHands({package:r.riderPackage},{quiet:true});
  }catch(e){fail(e);}
}

// ---------- updates (checked on launch; nothing downloads until asked)
let update=null,updateInfo=null,updateBarHidden=false;
const mb=n=>(n/1048576).toFixed(n<10485760?1:0)+' MB';
function renderUpdate(){
  const bar=$('updateBar'),s=update;bar.replaceChildren();let show=false;
  const btn=(text,fn,cls)=>h('button',{class:cls||null,text,onclick:fn});
  const later=()=>btn('Not now',()=>{updateBarHidden=true;renderUpdate();},'quiet');
  if(s?.status==='available'&&!updateBarHidden){show=true;
    bar.append(h('span',{class:'grow'},h('b',{text:`Moto Lines Studio ${s.version}`}),` is available. You have ${s.current}.`,s.error?h('span',{class:'err',text:'  '+s.error}):null),
      btn(`Download (${mb(s.size)})`,()=>API.downloadUpdate(),'primary'),btn('What’s new',showNotes,'quiet'),btn('Skip this version',()=>{API.skipUpdate();status(`Version ${s.version} skipped. Help → Check for updates finds it again.`);},'quiet'),later());}
  else if(s?.status==='downloading'){show=true;
    bar.append(h('span',{class:'grow'},`Downloading Moto Lines Studio ${s.version}…`),h('progress',{max:'1',value:String(s.progress||0)}),h('span',{text:Math.round((s.progress||0)*100)+'%'}));}
  else if(s?.status==='ready'){show=true;
    bar.append(h('span',{class:'grow'},h('b',{text:`Moto Lines Studio ${s.version}`}),' is downloaded and checked. It starts the next time you open the app.'),
      btn('Restart now',async()=>{if(!await API.restartToUpdate())status('Restart cancelled.');},'primary'),btn('What’s new',showNotes,'quiet'));}
  else if(s?.status==='full'&&!updateBarHidden){show=true;
    bar.append(h('span',{class:'grow'},h('b',{text:`Moto Lines Studio ${s.version}`}),' needs a full download this time (the app runtime changed).'),
      btn('Open download page',()=>API.openReleasePage(),'primary'),btn('What’s new',showNotes,'quiet'),later());}
  bar.hidden=!show;
}
function showNotes(){
  if(!update?.version)return;$('whatsNewTitle').textContent=`What’s new in ${update.version}`;$('whatsNewText').textContent=update.notes||'No notes for this release.';
  $('whatsNewDownload').hidden=update.status!=='available';$('whatsNew').showModal();
}
$('whatsNewDownload').onclick=()=>{$('whatsNew').close();API.downloadUpdate();};
function renderAbout(){
  const u=updateInfo;
  $('updateInfo').textContent=!u?.enabled?'Updates aren’t set up for this copy of the app.':
    `Updates come from github.com/${u.repo} and are checked against a signature before installing.`+(u.bundled&&u.current&&u.bundled!==u.current?` Running update ${u.current} (this folder shipped ${u.bundled}).`:'')+(u.bootError?` ${u.bootError}`:'');
  $('autoUpdateCheck').checked=prefs.autoUpdateCheck!==false;$('autoUpdateCheck').disabled=$('checkUpdatesNow').disabled=!u?.enabled;
}
async function checkForUpdates(){
  updateBarHidden=false;status('Checking for updates…');
  try{
    const s=await API.checkUpdates();update=s;renderUpdate();
    if(s.status==='none')message('You’re up to date',`Moto Lines Studio ${s.current} is the latest version.`);
    else if(s.status==='error'||s.error)message('Couldn’t check for updates',s.error||'Unknown error.');
    status(s.status==='available'?`Version ${s.version} is available.`:s.status==='none'?'You’re up to date.':'Update check finished.');
  }catch(e){fail(e);}
}
API.onUpdate(s=>{const was=update?.status;update=s;renderUpdate();
  if(s.status==='ready'&&was==='downloading')status(`Moto Lines Studio ${s.version} is ready. Restart to use it.`);
  if(s.status==='available'&&was==='downloading'&&s.error)status('Update download failed: '+s.error);});
$('autoUpdateCheck').onchange=()=>savePref({autoUpdateCheck:$('autoUpdateCheck').checked});
$('checkUpdatesNow').onclick=()=>{$('about').close();checkForUpdates();};

// ---------- start
window.__mls={get vp(){return vp;}}; // read-only hook for the GUI tests
function applyPrefs(p){
  prefs={...prefs,...p};if(p.handAlignment)alignment=p.handAlignment;
  $('linkHands').checked=!!prefs.linkHands;$('gameHanded').checked=prefs.gameHanded!==false;$('showHands').checked=prefs.showHands;$('grid').checked=prefs.grid;$('wire').checked=prefs.wire;$('helpers').checked=prefs.helpers;$('snap').checked=prefs.snap;$('ghost').checked=prefs.ghost;
  $('handOpacity').value=prefs.handOpacity;applyDisplayPrefs();
}
render();
try{
  boot=await API.startup();applyPrefs(boot.prefs||{});
  $('version').textContent=`${boot.product} ${boot.version}`;$('aboutVersion').textContent=boot.version;
  updateInfo=boot.update||null;if(updateInfo?.state)update=updateInfo.state;renderUpdate();renderAbout();
  renderRecent(boot.recent?.cfg||[]);renderLegacy(boot.legacy);render();
  const p=boot.project||{};
  if(p.model)await openModel(p.model);
  if(p.cfg&&(!draft||draft.file.path!==p.cfg))await openCfg(p.cfg);
  if(p.hands)await openHands(p.hands,{quiet:true});
  else if(boot.riderPackage){await openHands({package:boot.riderPackage},{quiet:true});if(boot.riderDetected&&vp.handsLoaded)status('Found rider.pkz in your MX Bikes folder and loaded the stock rider’s hands.');}
  if(!vp.handsLoaded&&!p.hands)await openHands({generic:true},{quiet:true});
  if(!draft&&!vp.hasModel)status('Ready. Open a GFX to begin.');
}catch(e){fail(e);}
