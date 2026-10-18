import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const built=JSON.parse(await readFile(join(root,'artifacts','package-build.json'),'utf8'));
const bytes=await readFile(built.archive);const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
const prefix='welfare-workspace-windows/';const checks=[];
const extracted=await mkdtemp(join(root,'artifacts','package-check-'));
for(const [name,entry]of Object.entries(zip.files)){
  assert(name.startsWith(prefix));assert(!name.includes('../'));assert(!/samples\/|\.mapping\.csv|\/\.env|\/og\.png/.test(name));
  const target=resolve(extracted,name);assert(target.startsWith(extracted+sep));
  if(entry.dir){await mkdir(target,{recursive:true});continue;}
  await mkdir(dirname(target),{recursive:true});await writeFile(target,await entry.async('nodebuffer'));
}
checks.push('ZIP CRC and bounded extraction; no source samples or mapping CSV');
const directory=join(extracted,'welfare-workspace-windows');
const sums=(await readFile(join(directory,'SHA256SUMS.txt'),'utf8')).trim().split('\n');
for(const line of sums){const match=/^([a-f0-9]{64})  (.+)$/.exec(line);assert(match);const data=await readFile(join(directory,match[2]));assert.equal(createHash('sha256').update(data).digest('hex'),match[1],match[2]);}
assert.equal(sums.length,built.files);checks.push(`all ${sums.length} packaged file SHA-256 hashes match`);
for(const path of ['啟動工作台.cmd','README.md','NOTICE.md','LICENSE','docs/verification.md','docs/pilot-checklist.md','docs/task-2-report.md','runtime/LICENSE.txt','dependency-licenses/NotoSansTC-OFL.txt'])assert((await readFile(join(directory,path))).length>0,path);
checks.push('launcher, usage notes, pilot form and licenses present');
const port=4184,origin=`http://127.0.0.1:${port}`;
const child=spawn(join(directory,'runtime','node.exe'),['scripts/serve-local.mjs'],{cwd:directory,env:{...process.env,WELFARE_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
const errors=[];child.stderr.on('data',chunk=>errors.push(String(chunk)));
try{
  await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Packaged server startup timed out')),10000);child.stdout.once('data',()=>{clearTimeout(timer);done();});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{if(code){clearTimeout(timer);reject(new Error(`Packaged server failed ${code}`));}});});
  const index=await fetch(origin);assert.equal(index.status,200);assert.match(index.headers.get('content-security-policy'),/connect-src 'self' blob:/);
  const html=await index.text();assert.match(html,/社福去識別化/);
  const assets=[...html.matchAll(/(?:src|href)="(\.\/assets\/[^\"]+)"/g)].map(m=>m[1]);assert(assets.length>=2);
  for(const path of [...assets,'./fonts/NotoSansTC-Regular.ttf','./ocr/worker.min.js','./ocr/core/tesseract-core-lstm.wasm.js','./ocr/lang/chi_tra.traineddata.gz','./ocr/lang/eng.traineddata.gz'])assert.equal((await fetch(new URL(path,origin),{method:'HEAD'})).status,200,path);
  assert.equal((await fetch(origin,{method:'POST',body:'synthetic-only'})).status,405);assert.equal(errors.length,0);
  checks.push('extracted bundled Node starts loopback server; application and OCR assets available; POST rejected');
}finally{if(child.exitCode===null&&!child.killed){const closed=new Promise(done=>child.once('exit',done));child.kill();await closed;}}
const report={timestamp:new Date().toISOString(),archive:built.archive,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),extractedDirectory:directory,passed:checks.length,checks,serverErrors:errors};
await writeFile(join(root,'artifacts','package-verification.json'),JSON.stringify(report,null,2));
await writeFile(`${built.archive}.sha256`,`${report.sha256}  社福去識別化-0.1.0-Windows離線包.zip\n`);
process.stdout.write(JSON.stringify(report,null,2)+'\n');
