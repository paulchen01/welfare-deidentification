import {readFile,writeFile,mkdir,mkdtemp,cp,readdir,stat} from 'node:fs/promises';
import {resolve,relative,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(join(root,'artifacts'),{recursive:true});
// Always stage a fresh tree so a rebuild cannot include obsolete files.
const target=await mkdtemp(join(root,'artifacts','welfare-workspace-windows-'));
await mkdir(join(target,'runtime'),{recursive:true});await mkdir(join(target,'scripts'),{recursive:true});
await cp(join(root,'dist'),join(target,'dist'),{recursive:true,filter:src=>!src.includes(`${join('dist','samples')}`)&&!src.endsWith('og.png')});
await cp(join(root,'scripts','serve-local.mjs'),join(target,'scripts','serve-local.mjs'));
await cp(process.execPath,join(target,'runtime','node.exe'));
await cp(join(root,'docs','node-runtime-LICENSE.txt'),join(target,'runtime','LICENSE.txt'));
for(const name of ['README.md','NOTICE.md','LICENSE'])await cp(join(root,name),join(target,name));
await cp(join(root,'docs','verification.md'),join(target,'驗收紀錄.md'));
await mkdir(join(target,'docs'),{recursive:true});
for(const name of ['verification.md','pilot-checklist.md','task-1-report.md','task-2-report.md','final-review.md'])await cp(join(root,'docs',name),join(target,'docs',name));
await writeFile(join(target,'啟動工作台.cmd'),'@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\ntitle 社福去識別化工作台\r\necho 正在啟動本機工作台；關閉此視窗即可停止。\r\n"runtime\\node.exe" "scripts\\serve-local.mjs" --open\r\nif errorlevel 1 pause\r\n','utf8');
const licenseDir=join(target,'dependency-licenses');await mkdir(licenseDir,{recursive:true});
await cp(join(root,'docs','NotoSansTC-OFL.txt'),join(licenseDir,'NotoSansTC-OFL.txt'));
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
const licenseSummary=[];
for(const [pkgPath,meta]of Object.entries(lock.packages)){
  if(!pkgPath||!pkgPath.startsWith('node_modules/')||meta.dev)continue;
  const full=join(root,pkgPath);let entries;try{entries=await readdir(full);}catch{continue;}
  const label=pkgPath.replaceAll('node_modules/','').replaceAll('/','_');
  const matches=entries.filter(n=>/^(licen[sc]e|copying|notice|ofl)([.-]|$)/i.test(n));
  const saved=[];
  for(const name of matches){const source=join(full,name);if(!(await stat(source)).isFile())continue;const to=`${label}__${name}`;await cp(source,join(licenseDir,to));saved.push(to);}
  licenseSummary.push({package:pkgPath,version:meta.version,license:meta.license??'See upstream',files:saved});
}
await writeFile(join(licenseDir,'index.json'),JSON.stringify(licenseSummary,null,2));
const zip=new JSZip();const manifest=[];
async function add(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const full=join(directory,entry.name);if(entry.isDirectory()){await add(full);continue;}const name=relative(target,full).replaceAll('\\','/');if(name==='SHA256SUMS.txt')continue;const data=await readFile(full);zip.file(`welfare-workspace-windows/${name}`,data);manifest.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`);}}
await add(target);const sums=manifest.sort().join('\n')+'\n';await writeFile(join(target,'SHA256SUMS.txt'),sums);zip.file('welfare-workspace-windows/SHA256SUMS.txt',sums);
const zipPath=join(root,'artifacts','社福去識別化-0.1.0-Windows離線包.zip');
await writeFile(zipPath,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}}));
const result={directory:target,archive:zipPath,files:manifest.length,runtime:process.version};
await writeFile(join(root,'artifacts','package-build.json'),JSON.stringify(result,null,2));
process.stdout.write(JSON.stringify(result)+'\n');
