// Windows installer (NSIS) built from the finished app folder:
//   npm run build:installer   (after npm run build:win)
// Per-user install: no admin rights, desktop + Start menu shortcuts, uninstaller.
const pkg=require('./package.json');
module.exports={
  appId:'com.obindustries.motolinesstudio',
  productName:pkg.productName,
  executableName:pkg.productName,
  copyright:`© ${new Date().getFullYear()} OB Industries`,
  directories:{output:'dist/installer'},
  win:{target:[{target:'nsis',arch:['x64']}],icon:'assets/moto-lines.ico',signAndEditExecutable:false},
  nsis:{
    oneClick:true,perMachine:false,runAfterFinish:true,
    createDesktopShortcut:'always',createStartMenuShortcut:true,shortcutName:pkg.productName,
    installerIcon:'assets/moto-lines.ico',uninstallerIcon:'assets/moto-lines.ico',
    uninstallDisplayName:pkg.productName,
    deleteAppDataOnUninstall:false, // settings, backups and updates in %APPDATA% are kept
    artifactName:'Moto-Lines-Studio-Setup-${version}.${ext}'
  },
  publish:null
};
