import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {request} from 'node:http';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=4183,origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['scripts/serve-local.mjs'],{cwd:root,env:{...process.env,WELFARE_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
const checks=[];const errors=[];child.stderr.on('data',chunk=>errors.push(String(chunk)));
try{
  await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Local server startup timed out')),10_000);child.stdout.once('data',()=>{clearTimeout(timer);done();});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{if(code){clearTimeout(timer);reject(new Error(`Server failed ${code}`));}});});
  const index=await fetch(origin);assert.equal(index.status,200);assert.match(index.headers.get('content-security-policy'),/connect-src 'self' blob:/);assert.match(index.headers.get('content-security-policy'),/object-src 'none'/);assert.equal(index.headers.get('cache-control'),'no-store');
  checks.push('loopback page and restrictive CSP');
  const html=await index.text();assert.match(html,/社福去識別化/);const entry=[...html.matchAll(/(?:src|href)="(\.\/assets\/[^\"]+)"/g)].map(m=>m[1]);assert(entry.length>=2);
  for(const path of [...entry,'./fonts/NotoSansTC-Regular.ttf','./ocr/worker.min.js','./ocr/core/tesseract-core-lstm.wasm.js','./ocr/lang/chi_tra.traineddata.gz','./ocr/lang/eng.traineddata.gz']){const response=await fetch(new URL(path,origin),{method:'HEAD'});assert.equal(response.status,200,path);assert(Number(response.headers.get('content-length'))>0,path);}
  checks.push('entry modules, CSS, font, OCR worker/core/languages served locally');
  assert.equal((await fetch(origin,{method:'POST',body:'synthetic-only'})).status,405);checks.push('upload method rejected');
  const forgedHostStatus=await new Promise((done,reject)=>{const req=request(origin,{headers:{Host:'untrusted.invalid'}},res=>{res.resume();done(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(forgedHostStatus,403);checks.push('untrusted Host rejected');
  assert.notEqual((await fetch(`${origin}/%2e%2e%5cpackage.json`)).status,200);assert.equal((await fetch(`${origin}/missing-file`)).status,404);checks.push('path escape and missing file rejected');
  const digest=createHash('sha256').update(await readFile(resolve(root,'dist/index.html'))).digest('hex');
  const report={timestamp:new Date().toISOString(),checks,passed:checks.length,indexSha256:digest,serverErrors:errors};assert.equal(errors.length,0);
  await mkdir(resolve(root,'artifacts'),{recursive:true});await writeFile(resolve(root,'artifacts/http-verification.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{const closed=new Promise(done=>child.once('exit',done));child.kill();await closed;}
