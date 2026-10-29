(function(root) {
  'use strict';
  const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const numeric = v => NUMBER.test(String(v).trim()) && Number.isFinite(Number(v));
  // Some existing Moto Lines files contain an extra decimal separator from
  // older free-text editing (for example 0.23.5 or -0.0023.5).  Keep strict
  // validation, but make that one unambiguous formatting typo repairable.
  function repairNumeric(value) {
    const raw=String(value).trim();
    const match=/^([+-]?)(\d*)\.(\d+)\.(\d+)([eE][+-]?\d+)?$/.exec(raw);
    if(!match)return null;
    const fixed=match[1]+match[2]+'.'+match[3]+match[4]+(match[5]||'');
    return numeric(fixed)?fixed:null;
  }
  // Plate definitions are opaque to the lineup editor; preserve repeated blocks verbatim.
  const platePath = path => /^(cockpit\.)?(chassis|steer)\.plate(?:\.|$)/.test(path);
  function parse(text) {
    const fields = new Map(), blocks = new Set(); let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    function skip() {
      while (i < text.length) {
        if (/\s/.test(text[i])) { i++; continue; }
        if (text.startsWith('//',i) || text[i] === ';' || text[i] === '#') {
          while(i < text.length && text[i] !== '\n') i++; continue;
        }
        if (text.startsWith('/*',i)) { const end=text.indexOf('*/',i+2); if(end<0) throw Error('Unclosed comment'); i=end+2; continue; }
        break;
      }
    }
    function scope(parents, nested) {
      while(true) {
        skip(); if(i>=text.length) { if(nested) throw Error('Unclosed block: '+parents.join('.')); return; }
        if(text[i]==='}') { if(!nested) throw Error('Unexpected closing brace'); i++; return; }
        const m=/^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(i));
        if(!m) throw Error('Unsupported syntax at line '+(text.slice(0,i).split('\n').length));
        i+=m[0].length; const path=[...parents,m[0]].join('.'); skip();
        if(text[i]==='{') { if(blocks.has(path)&&!platePath(path)) throw Error('Duplicate block: '+path); blocks.add(path); i++; scope([...parents,m[0]],true); }
        else if(text[i]==='=') {
          i++; while(text[i]===' ' || text[i]==='\t') i++; const start=i; let quote=null;
          while(i<text.length) {
            const c=text[i];
            if(quote) { if(c==='\\' && text[i+1]===quote) {i+=2;continue;} if(c===quote) quote=null; }
            else { if(c==='"' || c==="'") quote=c; else if(c==='\n'||c==='\r'||c==='}'||c===';'||c==='#'||text.startsWith('//',i)||text.startsWith('/*',i)) break; }
            i++;
          }
          if(quote) throw Error('Unclosed quote: '+path);
          let end=i; while(end>start && /\s/.test(text[end-1])) end--;
          if(fields.has(path)&&!platePath(path)) throw Error('Duplicate field: '+path);
          fields.set(path,{path,start,end,value:text.slice(start,end)});
        } else throw Error('Expected = or { after '+path);
      }
    }
    scope([],false); return {text,fields,blocks};
  }
  function base(view,part) { return (view==='cockpit'?'cockpit.':'')+(part==='chain'?'chassis.chain':'steer.'+part); }
  function editable(path) { return /^(cockpit\.)?(chassis\.chain\.(pos\.[xyz]|engine\.[xyz]|axis|ratio)|steer\.(leftgrip|rightgrip)\.pos\.[xyz])$/.test(path); }
  function valid(path,value) {
    if(path.endsWith('.axis')) return /^[uv][+-]?$/.test(value);
    return numeric(value);
  }
  function patch(doc, edits) {
    let result=doc.text;
    const changes=Object.entries(edits).map(([path,value])=>{
      const f=doc.fields.get(path); if(!f||!editable(path)) throw Error('Field cannot be edited: '+path);
      if(!valid(path,String(value))) throw Error('Invalid value for '+path+': '+value);
      return {...f,value:String(value)};
    }).sort((a,b)=>b.start-a.start);
    for(const f of changes) result=result.slice(0,f.start)+f.value+result.slice(f.end);
    return result;
  }
  function issues(doc) {
    const out=[];
    for(const f of doc.fields.values()) if(editable(f.path)&&!valid(f.path,f.value)) out.push({path:f.path,message:'Invalid '+(f.path.endsWith('.axis')?'texture axis':'number')+': '+f.value});
    for(const view of ['external','cockpit']) for(const part of ['chain','leftgrip','rightgrip']) {
      const b=base(view,part); if(!doc.blocks.has(b)) continue;
      for(const suffix of (part==='chain'?['pos.x','pos.y','pos.z','engine.x','engine.y','engine.z','axis','ratio']:['pos.x','pos.y','pos.z']))
        if(!doc.fields.has(b+'.'+suffix)) out.push({path:b+'.'+suffix,message:'Missing required lineup field'});
    }
    return out;
  }
  function matchViews(doc,edits,source) {
    if(!['external','cockpit'].includes(source)) throw Error('Choose a source view.');
    const result={...edits};let count=0;
    for(const f of doc.fields.values()) {
      if(!editable(f.path)||f.path.startsWith('cockpit.')!==(source==='cockpit'))continue;
      const target=source==='cockpit'?f.path.slice(8):'cockpit.'+f.path;
      if(!doc.fields.has(target))throw Error('Both views require the matching field: '+target);
      const value=Object.hasOwn(edits,f.path)?edits[f.path]:f.value;
      if(!valid(f.path,String(value)))throw Error('Correct the source value: '+f.path);
      if(String(value)===doc.fields.get(target).value)delete result[target];else result[target]=String(value);
      count++;
    }
    if(!count)throw Error('No supported lineups in the source view.');
    return result;
  }
  const api={parse,patch,issues,base,editable,numeric,repairNumeric,valid,matchViews};
  if(typeof module!=='undefined') module.exports=api; else root.CFG=api;
})(typeof window!=='undefined'?window:globalThis);
