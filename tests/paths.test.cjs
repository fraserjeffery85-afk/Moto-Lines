const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const P=require('../src/main/paths.cjs');
test('settings live in AppData when installed, beside the exe when portable',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mls-paths-'));
  try{
    const exe=path.join(dir,'Moto Lines Studio.exe'),app={isPackaged:true,getPath:k=>k==='appData'?path.join(dir,'AppData','Roaming'):null};
    assert.equal(P.userDataDir(app,'/repo',{},exe),path.join(dir,'user-data'));
    fs.writeFileSync(path.join(dir,'Uninstall Moto Lines Studio.exe'),'');
    assert.ok(P.isInstalled(app,exe));
    assert.equal(P.userDataDir(app,'/repo',{},exe),path.join(dir,'AppData','Roaming','Moto Lines Studio'));
    assert.equal(P.userDataDir(app,'/repo',{MLS_USER_DATA:'/x'},exe),'/x');
    assert.equal(P.userDataDir({isPackaged:false},'/repo',{},exe),path.join('/repo','user-data'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
