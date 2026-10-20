import { cp,mkdir,mkdtemp,rename } from 'node:fs/promises';
import { join } from 'node:path';
// Stage a fresh allowlist so legacy sample documents and development artifacts are never published.
const stage=await mkdtemp('pages-stage-');
const files=['index.html','verification.html','trial.html','trial.css','trial.js','robots.txt','llms.txt'];
for(const file of files)await cp(join('dist',file),join(stage,file));
for(const dir of ['assets','fonts','ocr','trial-assets','licenses'])await cp(join('dist',dir),join(stage,dir),{recursive:true});
await mkdir('artifacts',{recursive:true});
const target=join('artifacts',stage);await rename(stage,target);
console.log(target);
