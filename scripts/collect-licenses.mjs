import {mkdir,cp,readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';

// The distributed website includes the notices alongside its executable assets.
const target='dist/licenses';await mkdir(target,{recursive:true});
const files=['project-LICENSE.txt','NOTICE.txt','NotoSansTC-OFL.txt'];
await cp('LICENSE',join(target,files[0]));
await cp('NOTICE.md',join(target,files[1]));
await cp('docs/NotoSansTC-OFL.txt',join(target,files[2]));
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const summary=[];
for(const [path,meta]of Object.entries(lock.packages)){
  if(!path.startsWith('node_modules/')||meta.dev)continue;
  let entries;try{entries=await readdir(path);}catch(error){
    // npm omits optional native binaries for other operating systems; these are not distributed.
    if(meta.optional&&error.code==='ENOENT')continue;
    throw new Error(`Missing production dependency: ${path}`);
  }
  const label=path.replaceAll('node_modules/','').replaceAll('/','_');
  const saved=[];
  for(const name of entries.filter(n=>/^(licen[sc]e|copying|notice|ofl)([.-]|$)/i.test(n))){
    if(!(await stat(join(path,name))).isFile())continue;
    const file=`${label}__${name}`;await cp(join(path,name),join(target,file));saved.push(file);files.push(file);
  }
  summary.push({package:path,version:meta.version,license:meta.license??'See upstream',files:saved});
}
await writeFile(join(target,'index.json'),JSON.stringify(summary,null,2));
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
await writeFile(join(target,'index.html'),`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'"><title>社福工作台｜來源與授權</title><h1>來源與授權</h1><p>原作者、衍生版本及第三方套件的授權資訊隨網站一同提供。</p><p><a href="../">返回工作台</a> · <a href="index.json">套件版本清單</a></p><ul>${files.map(file=>`<li><a href="${escape(encodeURIComponent(file))}">${escape(file)}</a></li>`).join('')}</ul></html>`);
console.log(`Included ${files.length} license and notice files.`);
