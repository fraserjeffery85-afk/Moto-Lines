const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {findRiderPackage,libraryPaths,steamRoots}=require('../src/main/steam.cjs');
test('Steam library folders are parsed, and rider.pkz is found in a secondary library',async()=>{
  const vdf='"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}\n';
  assert.deepEqual(libraryPaths(vdf),['C:\\Program Files (x86)\\Steam','D:\\SteamLibrary']);
  assert.deepEqual(steamRoots({},'linux'),[]);
  assert.deepEqual(steamRoots({'ProgramFiles(x86)':'C:\\PF86',ProgramFiles:'C:\\PF'},'win32').map(p=>p.replace(/\\/g,'/')),['C:/PF86/Steam','C:/PF/Steam']);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mls-steam-'));
  try{
    const root=path.join(dir,'Steam'),lib=path.join(dir,'Games Library');
    await fs.mkdir(path.join(root,'steamapps'),{recursive:true});
    assert.equal(await findRiderPackage({MLS_STEAM_DIRS:root},'linux'),null);
    await fs.writeFile(path.join(root,'steamapps','libraryfolders.vdf'),`"libraryfolders"\n{\n\t"1"\n\t{\n\t\t"path"\t\t"${lib.replace(/\\/g,'\\\\')}"\n\t}\n}\n`);
    const pkz=path.join(lib,'steamapps','common','MX Bikes','rider.pkz');await fs.mkdir(path.dirname(pkz),{recursive:true});await fs.writeFile(pkz,'x');
    assert.equal(await findRiderPackage({MLS_STEAM_DIRS:root},'linux'),pkz);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
