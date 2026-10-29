const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs');
try { const bytes=fs.readFileSync(workerData),result=require('./edf.cjs').decodeEDF(bytes);result.sha256=require('node:crypto').createHash('sha256').update(bytes).digest('hex');parentPort.postMessage({result}); }
catch(e){parentPort.postMessage({error:e.message});}
