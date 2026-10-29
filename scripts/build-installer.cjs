'use strict';
// Wraps the finished app folder (npm run build:win) into one Setup.exe:
//   dist/installer/Moto-Lines-Studio-Setup-<version>.exe
// On Linux this needs Wine with 32-bit support (NSIS is 32-bit); on Windows it runs natively.
const path=require('node:path'),fs=require('node:fs');
const {build,Platform,Arch}=require('electron-builder');
const ROOT=path.join(__dirname,'..'),pkg=require('../package.json');
const DIST=path.resolve(process.env.MLS_DIST||path.join(ROOT,'dist'));
const APP=path.join(DIST,`Moto-Lines-Studio-v${pkg.version}-Windows`);
if(!fs.existsSync(path.join(APP,`${pkg.productName}.exe`))){console.error(`Build the app first (npm run build:win): ${APP} not found.`);process.exit(1);}
build({projectDir:ROOT,prepackaged:APP,targets:Platform.WINDOWS.createTarget('nsis',Arch.x64),config:require('../installer.config.cjs'),publish:'never'})
  .then(files=>files.filter(f=>f.endsWith('.exe')).forEach(f=>console.log(f)))
  .catch(e=>{console.error(e.message||e);process.exitCode=1;});
