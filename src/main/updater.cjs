'use strict';
// Checks GitHub Releases for a newer Moto Lines Studio, downloads it only when the
// user asks, verifies it (update-core.cjs) and installs it beside the app. The
// boot loader starts the new version on the next launch, or now via Restart.
const {app,net,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const core=require('./update-core.cjs');
const pkg=require('../../package.json');
const MAX_SMALL=1024*1024;

function createUpdater({settings,userData,send}){
  const dev=!app.isPackaged;
  const repo=(dev&&process.env.MLS_UPDATE_REPO)||pkg.updates?.github||null;
  const api=((dev&&process.env.MLS_UPDATE_API)||'https://api.github.com').replace(/\/$/,'');
  const keyFile=(dev&&process.env.MLS_UPDATE_PUBKEY)||path.join(__dirname,'update-public-key.pem');
  const publicKeyPem=fs.existsSync(keyFile)?fs.readFileSync(keyFile,'utf8'):null;
  const boot=global.__mlsBoot||{active:pkg.version,bundled:pkg.version,root:null};
  const current=boot.active||pkg.version,root=path.join(userData,'updates');
  const enabled=!!(repo&&/^[\w.-]+\/[\w.-]+$/.test(repo)&&publicKeyPem);
  let state={status:enabled?'idle':'disabled',current,repo,version:null,notes:'',size:0,progress:0,error:null,releaseUrl:null};
  let release=null,busy=false;
  const set=patch=>{state={...state,...patch};send(state);};
  const headers={'User-Agent':`MotoLinesStudio/${current}`,'Accept':'application/vnd.github+json'};
  async function get(url,limit){
    const res=await net.fetch(url,{headers,redirect:'follow',cache:'no-store'});
    if(!res.ok)throw Error(res.status===404?'No published release was found.':`GitHub replied ${res.status}.`);
    const buf=Buffer.from(await res.arrayBuffer());if(buf.length>limit)throw Error('Release file is larger than expected.');return buf;
  }
  function releasePage(url){return typeof url==='string'&&url.startsWith(`https://github.com/${repo}/releases/`)?url:`https://github.com/${repo}/releases/latest`;}

  async function check({manual=false}={}){
    if(!enabled){if(manual)set({error:'Updates aren’t set up for this copy of the app.'});return state;}
    if(busy)return state;busy=true;set({status:'checking',error:null});
    try{
      const latest=JSON.parse((await get(`${api}/repos/${repo}/releases/latest`,MAX_SMALL)).toString('utf8'));
      const asset=n=>(latest.assets||[]).find(a=>a.name===n);
      const mf=asset('update.json'),sig=asset('update.json.sig');
      if(!mf||!sig)throw Error('The latest release has no update package.');
      const manifestBytes=await get(mf.browser_download_url,MAX_SMALL),signature=(await get(sig.browser_download_url,4096)).toString('utf8');
      const m=core.verifyManifest(manifestBytes,signature,publicKeyPem);
      const zip=asset(m.zip.name);
      release={manifest:m,manifestBytes,signature,zipUrl:zip?.browser_download_url||null};
      const releaseUrl=releasePage(latest.html_url);
      if(core.compare(m.version,current)<=0){set({status:'none',version:m.version,releaseUrl});return state;}
      if(!manual&&settings.data.prefs.skippedUpdate===m.version){set({status:'skipped',version:m.version,releaseUrl});return state;}
      if(core.compare(m.minElectron,process.versions.electron)>0){set({status:'full',version:m.version,notes:m.notes,releaseUrl});return state;}
      if(!zip)throw Error('The latest release is missing its update file.');
      // Already downloaded earlier (e.g. "Later" was chosen)?
      try{core.verifyInstalledSync(path.join(root,'app-'+m.version),publicKeyPem);set({status:'ready',version:m.version,notes:m.notes,size:m.zip.size,releaseUrl});return state;}catch{}
      set({status:'available',version:m.version,notes:m.notes,size:m.zip.size,releaseUrl});
    }catch(e){set({status:manual?'error':'idle',error:manual?friendly(e):null});}
    finally{busy=false;}
    return state;
  }
  async function download(){
    if(!release||state.status!=='available'||busy)return state;busy=true;set({status:'downloading',progress:0,error:null});
    try{
      const res=await net.fetch(release.zipUrl,{headers,redirect:'follow',cache:'no-store'});
      if(!res.ok)throw Error(`Download failed (${res.status}).`);
      const total=release.manifest.zip.size,chunks=[];let got=0,lastSent=0;
      const reader=res.body.getReader();
      for(;;){const {done,value}=await reader.read();if(done)break;got+=value.length;if(got>total)throw Error('The download is larger than its signed size.');chunks.push(Buffer.from(value));
        const p=got/total;if(p-lastSent>=.02){lastSent=p;set({progress:p});}}
      await core.installPackage({zipBytes:Buffer.concat(chunks),manifestBytes:release.manifestBytes,signature:release.signature,publicKeyPem,root});
      core.cleanup(root,[current,release.manifest.version]).catch(()=>{});
      set({status:'ready',progress:1});
    }catch(e){set({status:'available',error:friendly(e)});}
    finally{busy=false;}
    return state;
  }
  function skip(){if(state.version){settings.setPrefs({skippedUpdate:state.version});set({status:'skipped'});}}
  function openReleasePage(){if(repo)shell.openExternal(releasePage(state.releaseUrl));}
  function started(){if(boot.root&&boot.active!==boot.bundled)core.markGood(boot.root,boot.active);}
  function friendly(e){const m=String(e?.message||e);return /ENOTFOUND|ERR_INTERNET|ERR_NAME|network|fetch failed/i.test(m)?'Couldn’t reach GitHub. Check the internet connection and try again.':m;}
  return {check,download,skip,openReleasePage,started,get state(){return state;},enabled,info:{repo,current,bundled:boot.bundled,skipped:boot.skipped||[],bootError:boot.error||null}};
}
module.exports={createUpdater};
