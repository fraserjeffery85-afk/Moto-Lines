'use strict';
// Builds the signed update package from a finished Windows build:
//   dist/update/moto-lines-studio-app-<version>.zip, update.json, update.json.sig
// Key: MLS_UPDATE_KEY (PEM text, e.g. from a GitHub secret) or MLS_UPDATE_KEY_FILE.
const fs=require('node:fs'),path=require('node:path');
const core=require('../src/main/update-core.cjs');
const ROOT=path.join(__dirname,'..'),pkg=require('../package.json');
const DIST=path.resolve(process.env.MLS_DIST||path.join(ROOT,'dist'));
const APP=process.argv[2]||path.join(DIST,`Moto-Lines-Studio-v${pkg.version}-Windows`,'resources','app');
const OUT=path.join(DIST,'update');

function notesFor(version){
  const text=fs.readFileSync(path.join(ROOT,'CHANGELOG.md'),'utf8');
  const m=new RegExp(`^## ${version.replace(/\./g,'\\.')}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,'m').exec(text);
  return (m?m[1]:'').replace(/^#+\s*/gm,'').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').trim()||`Moto Lines Studio ${version}`;
}
(async()=>{
  const key=process.env.MLS_UPDATE_KEY||(process.env.MLS_UPDATE_KEY_FILE&&fs.readFileSync(process.env.MLS_UPDATE_KEY_FILE,'utf8'));
  if(!key)throw Error('Set MLS_UPDATE_KEY or MLS_UPDATE_KEY_FILE to the private signing key.');
  const appPkg=JSON.parse(fs.readFileSync(path.join(APP,'package.json'),'utf8'));
  if(appPkg.version!==pkg.version)throw Error(`Build is ${appPkg.version}, package.json is ${pkg.version}. Rebuild first.`);
  const publicKey=fs.readFileSync(path.join(APP,'src','main','update-public-key.pem'),'utf8');
  const files=core.listFiles(APP);
  const {zipSync}=await import('three/addons/libs/fflate.module.js');
  const entries={};for(const rel of Object.keys(files))entries[rel]=[new Uint8Array(fs.readFileSync(path.join(APP,...rel.split('/')))),{level:9,mtime:new Date('2026-01-01T00:00:00Z')}];
  const zip=Buffer.from(zipSync(entries)),zipName=`moto-lines-studio-app-${pkg.version}.zip`;
  const manifest={format:1,version:pkg.version,released:new Date().toISOString().slice(0,10),
    minElectron:require('../node_modules/electron/package.json').version,notes:notesFor(pkg.version),
    zip:{name:zipName,size:zip.length,sha256:core.sha256(zip)},files};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),signature=core.sign(bytes,key);
  core.verifyManifest(bytes,signature,publicKey); // the shipped public key must accept it
  fs.rmSync(OUT,{recursive:true,force:true});fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,zipName),zip);fs.writeFileSync(path.join(OUT,'update.json'),bytes);fs.writeFileSync(path.join(OUT,'update.json.sig'),signature+'\n');
  console.log(`update ${pkg.version}: ${zipName} ${(zip.length/1048576).toFixed(1)} MB, ${Object.keys(files).length} files, signed`);
})().catch(e=>{console.error(e.message||e);process.exitCode=1;});
