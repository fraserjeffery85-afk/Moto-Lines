'use strict';
// Narrow bridge: the renderer can only call these named desktop actions.
const {contextBridge,ipcRenderer,webUtils}=require('electron');
const call=(name,...args)=>ipcRenderer.invoke(name,...args);
contextBridge.exposeInMainWorld('desktop',{
  startup:()=>call('startup'),
  openCfg:file=>call('open-cfg',file),
  openModel:file=>call('open-model',file),
  openHands:files=>call('open-hands',files),
  save:(edits,saveAs)=>call('save',edits,saveAs),
  dirty:value=>call('dirty',value),
  setPrefs:patch=>call('set-prefs',patch),
  forgetRecent:(kind,file)=>call('forget-recent',kind,file),
  openBackups:()=>call('open-backups'),
  revealCfg:()=>call('reveal-cfg'),
  listBackups:()=>call('list-backups'),
  readBackup:name=>call('read-backup',name),
  restoreBackup:name=>call('restore-backup',name),
  importLegacy:folder=>call('import-legacy',folder),
  dismissLegacy:()=>call('dismiss-legacy'),
  checkUpdates:()=>call('update-check'),
  downloadUpdate:()=>call('update-download'),
  skipUpdate:()=>call('update-skip'),
  restartToUpdate:()=>call('update-restart'),
  openReleasePage:()=>call('update-release-page'),
  onUpdate:callback=>ipcRenderer.on('update',(_event,state)=>callback(state)),
  filePath:file=>webUtils.getPathForFile(file),
  onCommand:callback=>ipcRenderer.on('command',(_event,command)=>callback(command))
});
