'use strict';
// Finds rider.pkz in a Steam install of MX Bikes, including extra Steam library
// folders listed in steamapps/libraryfolders.vdf. Read-only. MLS_STEAM_DIRS
// (path-delimiter separated Steam roots) overrides the defaults for testing.
const fs=require('node:fs/promises'),path=require('node:path');

function steamRoots(env=process.env,platform=process.platform){
  if(env.MLS_STEAM_DIRS)return env.MLS_STEAM_DIRS.split(path.delimiter).filter(Boolean);
  if(platform!=='win32')return [];
  return [env['ProgramFiles(x86)'],env.ProgramFiles].filter(Boolean).map(p=>path.join(p,'Steam'));
}
function libraryPaths(vdf){
  const out=[];for(const m of vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g))out.push(m[1].replace(/\\\\/g,'\\'));return out;
}
async function riderCandidates(env,platform){
  const libs=new Set();
  for(const root of steamRoots(env,platform)){
    libs.add(root);
    try{for(const p of libraryPaths(await fs.readFile(path.join(root,'steamapps','libraryfolders.vdf'),'utf8')))libs.add(p);}catch{}
  }
  return [...libs].map(lib=>path.join(lib,'steamapps','common','MX Bikes','rider.pkz'));
}
async function findRiderPackage(env,platform){
  for(const file of await riderCandidates(env,platform)){try{if((await fs.stat(file)).isFile())return file;}catch{}}
  return null;
}
module.exports={findRiderPackage,riderCandidates,libraryPaths,steamRoots};
