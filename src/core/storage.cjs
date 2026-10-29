const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const CFG=require('./cfg-core.js'),paths=require('node:path');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const BACKUP=/\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.[0-9a-f]{6}\.bak$/;
function decode(b) {
  let encoding='utf8';
  if(b[0]===255&&b[1]===254)encoding='utf16le';
  else if(b[0]===254&&b[1]===255)throw Error('UTF-16 big-endian is unsupported; use a UTF-8 copy.');
  else {try {new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{encoding='latin1';}}
  return {text:b.toString(encoding),encoding};
}
// Managed backups live outside bike folders, grouped by bike folder name plus a
// hash of the full (case-folded) path so two bikes called "gfx.cfg" never mix.
function backupFolder(path,backupRoot) {
  return backupRoot?paths.join(backupRoot,paths.basename(paths.dirname(path))+'-'+hash(Buffer.from(paths.resolve(path).toLowerCase())).slice(0,12)):paths.dirname(path);
}
async function readCfg(path) {const bytes=await fs.readFile(path);if(bytes.length>4*1024*1024)throw Error('CFG exceeds 4 MB');const data=decode(bytes);CFG.parse(data.text);return {...data,path,hash:hash(bytes)};}
// Shared replace step: temp write + flush, re-check destination, exact backup of
// the previous bytes, then rename. There is still a small check-to-replace race.
async function replace(path,bytes,expectedHash,backupRoot) {
  const temp=path+'.'+crypto.randomUUID()+'.tmp';let backup=null;
  let old;try{old=await fs.readFile(path);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(expectedHash&&(!old||hash(old)!==expectedHash))throw Error('The file changed outside the editor. Reopen it or save to a new file.');
  try {
    await fs.writeFile(temp,bytes,{flag:'wx'});const handle=await fs.open(temp,'r+');try{await handle.sync();}finally{await handle.close();}
    if(old){
      const now=await fs.readFile(path);if(hash(now)!==hash(old))throw Error('The destination changed while saving; retry after reopening.');
      const folder=backupFolder(path,backupRoot);
      await fs.mkdir(folder,{recursive:true});
      backup=paths.join(folder,paths.basename(path))+'.'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+crypto.randomBytes(3).toString('hex')+'.bak';
      await fs.writeFile(backup,old,{flag:'wx'});
      await fs.rename(temp,path);
    } else {await fs.copyFile(temp,path,require('node:fs').constants.COPYFILE_EXCL);await fs.unlink(temp);}
    return {path,hash:hash(bytes),backup};
  } catch(e) {await fs.unlink(temp).catch(()=>{});throw e;}
}
async function safeWrite(path,text,encoding,expectedHash,backupRoot) {
  if(CFG.issues(CFG.parse(text)).length)throw Error('Correct all lineup validation errors before saving.');
  return replace(path,Buffer.from(text,encoding),expectedHash,backupRoot);
}
// Recovery copies for one CFG, newest first. Only names this app generated.
async function listBackups(path,backupRoot) {
  const folder=backupFolder(path,backupRoot),name=paths.basename(path);let entries=[];
  try{entries=await fs.readdir(folder);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const out=[];
  for(const file of entries){
    if(!file.startsWith(name+'.'))continue;const m=BACKUP.exec(file.slice(name.length));if(!m)continue;
    const stat=await fs.stat(paths.join(folder,file));if(!stat.isFile())continue;
    const t=m[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,'T$1:$2:$3.$4Z');
    out.push({name:file,size:stat.size,created:new Date(t).toISOString()});
  }
  return out.sort((a,b)=>b.created.localeCompare(a.created)||b.name.localeCompare(a.name));
}
function backupPath(path,backupRoot,name) {
  if(typeof name!=='string'||paths.basename(name)!==name||!name.startsWith(paths.basename(path)+'.')||!BACKUP.test(name.slice(paths.basename(path).length)))throw Error('Unknown backup.');
  return paths.join(backupFolder(path,backupRoot),name);
}
async function readBackup(path,backupRoot,name) {
  const bytes=await fs.readFile(backupPath(path,backupRoot,name));if(bytes.length>4*1024*1024)throw Error('Backup exceeds 4 MB');
  return {...decode(bytes),hash:hash(bytes)};
}
// Restoring writes the backup's exact original bytes (no validation: it is the
// file as it was), after taking a fresh backup of the current file.
async function restoreBackup(path,backupRoot,name,expectedHash) {
  const bytes=await fs.readFile(backupPath(path,backupRoot,name));
  return replace(path,bytes,expectedHash,backupRoot);
}
module.exports={readCfg,safeWrite,hash,decode,backupFolder,listBackups,readBackup,restoreBackup};
