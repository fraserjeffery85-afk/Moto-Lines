'use strict';
// Creates the Ed25519 key pair that signs updates. Run once.
//   node scripts/keygen.cjs <private-key-file>
// The public key goes into src/main/update-public-key.pem (shipped in the app).
// Keep the private key secret: store it as the GitHub secret UPDATE_SIGNING_KEY
// and keep an offline backup. Losing it means users need one manual download
// of a build with a new public key; leaking it lets others sign updates.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const out=process.argv[2];if(!out){console.error('Usage: node scripts/keygen.cjs <private-key-file>');process.exit(1);}
const pubFile=path.join(__dirname,'..','src','main','update-public-key.pem');
if(fs.existsSync(out)||fs.existsSync(pubFile)){console.error('A key already exists. Refusing to overwrite: '+(fs.existsSync(out)?out:pubFile));process.exit(1);}
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(out,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
fs.writeFileSync(pubFile,publicKey.export({type:'spki',format:'pem'}));
console.log('Private key (keep secret):',path.resolve(out));console.log('Public key (shipped):',pubFile);
