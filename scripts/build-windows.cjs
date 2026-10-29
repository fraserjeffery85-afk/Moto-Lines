'use strict';
// Builds the portable Windows app:  dist/Moto-Lines-Studio-v<version>-Windows/ (+ .zip)
//  * Electron runtime: node_modules/electron/dist on Windows, otherwise the official
//    win32-x64 release zip (SHA-256 checked against the release's SHASUMS256.txt).
//  * The original Moto Lines multi-resolution icon and version info are embedded in
//    the .exe here (no separate embed-icon.py step). The exe is unsigned.
//  * user-data/ is never created or touched by the build: settings and backups of an
//    existing install live beside its own exe and are imported with Help → Import.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.join(__dirname,'..'),pkg=require('../package.json');
const ELECTRON=require('../node_modules/electron/package.json').version;
const NAME=`Moto-Lines-Studio-v${pkg.version}-Windows`,EXE=`${pkg.productName}.exe`;
const DIST=path.resolve(process.env.MLS_DIST||path.join(ROOT,'dist')),OUT=path.join(DIST,NAME);
const CACHE=path.join(ROOT,'.cache');
const log=(...a)=>console.log('·',...a);

async function download(url,file){
  if(fs.existsSync(file))return file;
  log('downloading',url);
  const res=await fetch(url,{redirect:'follow'});if(!res.ok)throw Error(`Download failed (${res.status}): ${url}`);
  const temp=file+'.part';await fsp.writeFile(temp,Buffer.from(await res.arrayBuffer()));await fsp.rename(temp,file);return file;
}
async function electronRuntime(){
  if(process.platform==='win32'&&fs.existsSync(path.join(ROOT,'node_modules/electron/dist/electron.exe')))return {dir:path.join(ROOT,'node_modules/electron/dist')};
  await fsp.mkdir(CACHE,{recursive:true});
  const base=`https://github.com/electron/electron/releases/download/v${ELECTRON}/`,zipName=`electron-v${ELECTRON}-win32-x64.zip`;
  const zip=await download(base+zipName,path.join(CACHE,zipName));
  const sums=await download(base+'SHASUMS256.txt',path.join(CACHE,`SHASUMS256-v${ELECTRON}.txt`));
  const expected=fs.readFileSync(sums,'utf8').split('\n').map(l=>l.trim().split(/\s+\*?/)).find(([,n])=>n===zipName)?.[0];
  const actual=crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  if(!expected||expected!==actual){fs.rmSync(zip,{force:true});throw Error(`Checksum mismatch for ${zipName}; deleted the cached copy, run the build again.`);}
  log('verified',zipName);
  return {zip};
}
async function copyDir(from,to,filter=()=>true){await fsp.cp(from,to,{recursive:true,dereference:true,filter});}

async function embedBranding(exePath){
  const ResEdit=await import('resedit');
  const exe=ResEdit.NtExecutable.from(fs.readFileSync(exePath),{ignoreCert:true});
  const res=ResEdit.NtExecutableResource.from(exe);
  const icon=ResEdit.Data.IconFile.from(fs.readFileSync(path.join(ROOT,'assets','moto-lines.ico')));
  const groups=ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target=groups[0]||{id:1,lang:1033};
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries,target.id,target.lang,icon.icons.map(i=>i.data));
  const [vi]=ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const [maj,min,patch]=pkg.version.split('.').map(Number);
  const lang={lang:1033,codepage:1200};
  vi.setFileVersion(maj,min,patch,0,1033);vi.setProductVersion(maj,min,patch,0,1033);
  vi.setStringValues(lang,{ProductName:pkg.productName,FileDescription:pkg.productName,CompanyName:'OB Industries',
    LegalCopyright:`© ${new Date().getFullYear()} OB Industries`,InternalName:pkg.productName,OriginalFilename:EXE,
    FileVersion:pkg.version,ProductVersion:pkg.version});
  vi.outputToResourceEntries(res.entries);res.outputResource(exe);
  fs.writeFileSync(exePath,Buffer.from(exe.generate()));
}

async function zipFolder(folder,file){
  const {zipSync}=await import('three/addons/libs/fflate.module.js');
  const files={},top=path.basename(folder);
  (function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);
    if(e.isDirectory())walk(p);else{const rel=top+'/'+path.relative(folder,p).split(path.sep).join('/');const data=fs.readFileSync(p);files[rel]=[new Uint8Array(data),{level:/\.(png|ico|woff2)$/i.test(p)?0:9,mtime:new Date()}];}}})(folder);
  fs.writeFileSync(file,zipSync(files));
}

(async()=>{
  if(fs.existsSync(OUT))throw Error(`${OUT} already exists. Delete it (or set MLS_DIST) to build fresh; the build never overwrites an existing app folder.`);
  await fsp.mkdir(OUT,{recursive:true});
  const runtime=await electronRuntime();
  if(runtime.dir)await copyDir(runtime.dir,OUT);
  else{
    log('extracting Electron',ELECTRON);
    const {unzipSync}=await import('three/addons/libs/fflate.module.js');
    const entries=unzipSync(new Uint8Array(fs.readFileSync(runtime.zip)));
    for(const [name,data] of Object.entries(entries)){if(name.endsWith('/'))continue;const p=path.join(OUT,...name.split('/'));fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
  }
  await fsp.rename(path.join(OUT,'electron.exe'),path.join(OUT,EXE));
  await fsp.rm(path.join(OUT,'resources','default_app.asar'),{force:true});
  const app=path.join(OUT,'resources','app');await fsp.mkdir(app,{recursive:true});
  // Update source: the GitHub repo that built this (Actions sets GITHUB_REPOSITORY),
  // or MLS_UPDATE_REPO, or package.json. Without one, the updater stays off.
  const repo=process.env.MLS_UPDATE_REPO||process.env.GITHUB_REPOSITORY||pkg.updates?.github||null;
  if(repo&&!/^[\w.-]+\/[\w.-]+$/.test(repo))throw Error('Update repo must look like owner/name: '+repo);
  if(repo&&!fs.existsSync(path.join(ROOT,'src','main','update-public-key.pem')))throw Error('src/main/update-public-key.pem is missing; run npm run keygen first.');
  log(repo?'updates from github.com/'+repo:'updates not configured (set MLS_UPDATE_REPO)');
  const manifest={name:pkg.name,productName:pkg.productName,description:pkg.description,author:pkg.author,version:pkg.version,private:true,main:pkg.main,updates:{github:repo}};
  await fsp.writeFile(path.join(app,'package.json'),JSON.stringify(manifest,null,2)+'\n');
  await copyDir(path.join(ROOT,'src'),path.join(app,'src'));
  await copyDir(path.join(ROOT,'assets'),path.join(app,'assets'));
  const three=path.join(ROOT,'node_modules','three'),threeOut=path.join(app,'node_modules','three');
  for(const part of ['package.json','LICENSE','build','examples/jsm'])await copyDir(path.join(three,part),path.join(threeOut,part));
  await fsp.copyFile(path.join(ROOT,'docs','READ ME.md'),path.join(OUT,'READ ME.md'));
  log('embedding icon and version info');await embedBranding(path.join(OUT,EXE));
  if(process.env.MLS_NO_ZIP!=='1'){log('zipping');await zipFolder(OUT,OUT+'.zip');}
  console.log(OUT);
})().catch(e=>{console.error(e.message||e);process.exitCode=1;});
