import JSZip from 'jszip';
import { PDFDocument,StandardFonts,rgb } from 'pdf-lib';
import { buildDocx,toFile } from '../helpers/docx-builder';
import { buildXlsx,toXlsxFile } from '../helpers/xlsx-builder';
import { detectWelfare,renderText } from '../../src/welfare/engine';
import { WELFARE_SAMPLES } from '../../src/welfare/samples';
import { parseSafeDocument,generateSafeDocument } from '../../src/welfare/document-safety';
import { createShareDocument,buildShareArchive,buildRecoveryBundle,type ShareEntry } from '../../src/welfare/export';
import { encryptRecovery,decryptRecovery,restoreExactText } from '../../src/welfare/vault';
import { parseProfile,serializeProfile,DEFAULT_PROFILE } from '../../src/welfare/profile';
import { parsePdf } from '../../src/formats/pdf';

const progress=document.getElementById('progress')!;
const results=document.getElementById('results')!;
const report=document.getElementById('report')!;
const run=document.getElementById('run-tests') as HTMLButtonElement;
const fetchLog:string[]=[];const violations:string[]=[];
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
  fetchLog.push(url.href);
  if(url.origin!==location.origin&&url.protocol!=='blob:')throw new Error('驗收禁止外部連線');
  return originalFetch(input,init);
};
document.addEventListener('securitypolicyviolation',event=>violations.push(`${event.effectiveDirective}:${event.blockedURI}`));
function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
function reviewed(parsed:Awaited<ReturnType<typeof parseSafeDocument>>):ShareEntry {
  const findings=detectWelfare(parsed.document.text,{purpose:'ai',groupId:'qa',people:[]});findings.forEach(f=>f.reviewed=true);
  return {id:crypto.randomUUID(),...parsed,findings,reviewConfirmed:true,mode:'native'};
}
async function zipText(blob:Blob):Promise<string>{const zip=await JSZip.loadAsync(await blob.arrayBuffer());const text=[];for(const file of Object.values(zip.files))if(!file.dir&&/\.(?:xml|rels|txt|json)$/i.test(file.name))text.push(await file.async('string'));return text.join('\n');}
function rawStorage():string {return JSON.stringify({local:{...localStorage},session:{...sessionStorage}});}

run.onclick=async()=>{
  run.disabled=true;results.replaceChildren();report.textContent='';const checks:{name:string;passed:boolean;detail:string}[]=[];
  const storageBefore=rawStorage();const started=new Date().toISOString();fetchLog.length=0;violations.length=0;
  const test=async(name:string,work:()=>Promise<string>)=>{progress.textContent=name;const item=document.createElement('li');results.append(item);try{const detail=await work();checks.push({name,passed:true,detail});item.textContent=`通過：${name} — ${detail}`;}catch(error){const detail=error instanceof Error?error.message:String(error);checks.push({name,passed:false,detail});item.textContent=`失敗：${name} — ${detail}`;}};
  let plain:ShareEntry;
  await test('60 筆社福合成資料與未選敘事保留',async()=>{
    let annotated=0;for(const s of WELFARE_SAMPLES){const out=renderText(s.text,detectWelfare(s.text,{purpose:'ai',groupId:s.people[0].groupId,people:s.people}));for(const term of s.expectedSensitive){assert(!out.includes(term),'合成標註原值殘留');annotated++;}assert(out.includes(s.text.split('\n').at(-1)!), '未選取敘事被改動');}return `${WELFARE_SAMPLES.length} 筆、${annotated} 個模板標註；不是實務正確率`;
  });
  await test('分享包中性檔名與對照分離',async()=>{
    const text='案主：王小明；電話：0912345678。王小明同意繼續服務。';
    plain=reviewed(await parseSafeDocument(new File([text],'王小明隱私檔名.txt',{type:'text/plain'})));plain.mode='text';
    const zip=await JSZip.loadAsync(await (await buildShareArchive([plain],'ai')).arrayBuffer());const names=Object.keys(zip.files);assert(names.length===2&&names.includes('文件-001.txt')&&names.includes('處理摘要.json'),'分享檔案結構不符');
    const output=await zipText(await buildShareArchive([plain],'ai'));for(const value of ['王小明','0912345678','隱私檔名','occurrences','originalFileName'])assert(!output.includes(value),'分享包含敏感原值或對照');
    return names.join('、');
  });
  await test('加密對照、錯誤密碼與精確文字還原',async()=>{
    const text=(await createShareDocument(plain,1)).text;const encrypted=await encryptRecovery(await buildRecoveryBundle([plain]),'synthetic-test-password');assert(!encrypted.includes('王小明'),'密文含原值');
    const bundle=await decryptRecovery(encrypted,'synthetic-test-password');assert(await restoreExactText(text,bundle.documents[0])===plain.document.text,'逐字還原不符');
    let wrong=false,changed=false;try{await decryptRecovery(encrypted,'wrong-password');}catch{wrong=true;}try{await restoreExactText(text+'改寫',bundle.documents[0]);}catch{changed=true;}
    assert(wrong&&changed,'錯誤輸入未被拒絕');return '正確密碼可還原；錯誤密碼與改寫文字均拒絕';
  });
  await test('Word 跨文字片段遮罩、回讀與重複匯出',async()=>{
    const parsed=await parseSafeDocument(toFile(await buildDocx({paragraphs:[['案主：王','小明；電話：0912','345678。'],['王小明同意持續服務。']]}),'虛構來源.docx'));
    assert(parsed.report.nativeAllowed,'簡單 Word 不應全部被拒絕');const entry=reviewed(parsed);const output=await createShareDocument(entry,1);assert(!(await zipText(output.blob)).includes('王小明'),'Word 封裝原值殘留');
    const reread=await parseSafeDocument(new File([output.blob],output.name));assert(reread.document.text.includes('[姓名]'),'Word 回讀缺標記');assert(!reread.document.text.includes('0912345678'),'Word 回讀電話殘留');
    const second=await createShareDocument(entry,1);assert(await zipText(second.blob)===await zipText(output.blob),'重複匯出被前次污染');assert(parsed.document.text.includes('王小明'),'原始物件被修改');return '支援的 Word 可輸出、回讀，來源未被修改';
  });
  await test('Word 隱藏批註阻擋原格式，保留可覆核文字',async()=>{
    const zip=await JSZip.loadAsync(await buildDocx({paragraphs:[['案主：王小明。']]}));zip.file('word/comments.xml','<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="1"><w:p><w:r><w:t>隱藏姓名</w:t></w:r></w:p></w:comment></w:comments>');
    const parsed=await parseSafeDocument(toFile(await zip.generateAsync({type:'uint8array'}),'批註.docx'));assert(!parsed.report.nativeAllowed&&parsed.document.text.includes('王小明'),'隱藏內容未標示');let rejected=false;
    try{await generateSafeDocument(parsed.document,[],{nativeAllowed:true,issues:[]});}catch{rejected=true;}assert(rejected,'偽造放行報告可繞過阻擋');return '直接呼叫仍重新檢查，不信任放行旗標';
  });
  await test('Excel 文字活頁簿遮罩、中性表名、數值限制',async()=>{
    const parsed=await parseSafeDocument(toXlsxFile(await buildXlsx({sheets:[{name:'王小明名冊',rows:[['案主：王小明','電話：0912345678']]}]}),'名冊.xlsx'));assert(parsed.report.nativeAllowed,'簡單文字活頁簿不應全部拒絕');
    const output=await createShareDocument(reviewed(parsed),1);const xml=await zipText(output.blob);assert(!xml.includes('王小明')&&!xml.includes('0912345678'),'Excel 封裝原值殘留');const reread=await parseSafeDocument(new File([output.blob],output.name));assert(reread.document.text.includes('[姓名]'),'Excel 回讀缺標記');
    const numeric=await parseSafeDocument(toXlsxFile(await buildXlsx({sheets:[{name:'數值',rows:[['電話',912345678]]}]}),'數值.xlsx'));assert(!numeric.report.nativeAllowed&&numeric.report.issues.length>0,'未抽取數值未被限制');return '文字格式可回讀；數值格式明示限制並阻擋';
  });
  await test('混合 PDF 首次逐頁 OCR、圖片移除與重建回讀',async()=>{
    const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage([600,300]).drawText('Phone 0912345678',{x:40,y:180,font,size:24,color:rgb(0,0,0)});
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=600;const context=canvas.getContext('2d')!;context.fillStyle='#fff';context.fillRect(0,0,1200,600);context.fillStyle='#000';context.font='bold 55px Arial';context.fillText('CASE 7654321',70,180);context.fillText('PHONE 0987654321',70,290);
    const image=await pdf.embedPng(canvas.toDataURL('image/png'));pdf.addPage([600,300]).drawImage(image,{x:0,y:0,width:600,height:300});
    const parsed=await parseSafeDocument(new File([new Uint8Array(await pdf.save())],'混合虛構.pdf',{type:'application/pdf'}),{ocr:{onProgress:p=>progress.textContent=`混合 PDF OCR 第 ${p.page}/${p.pages} 頁，${Math.round(p.progress*100)}%`}});
    assert(parsed.document.layout?.kind==='pdf'&&parsed.document.layout.pages.length===2,'PDF 頁數不符');
    assert(parsed.document.layout.pages.every(p=>p.items.some(i=>i.end>i.start)),'有頁面未辨識');assert(parsed.document.text.includes('7654321'),'第二頁影像文字未辨識');
    assert(parsed.document.layout.pages.every(p=>(p.pictures??[]).every(pic=>!pic.keep)),'有圖片預設保留');
    const entry=reviewed(parsed);assert(entry.report.nativeAllowed,'合成可讀 PDF 未允許重建');const output=await createShareDocument(entry,1);const reread=await parsePdf(new File([output.blob],output.name));
    assert(reread.layout?.kind==='pdf'&&reread.layout.pages.length===2,'PDF 回讀頁數不符');assert(!reread.text.includes('0912345678')&&!reread.text.includes('0987654321'),'PDF 直接識別殘留');return `2 頁均有文字；${entry.findings.length} 處規則辨識，輸出可重新讀取`;
  });
  await test('機構範本拒絕個案名單與儲存變動檢查',async()=>{
    assert(parseProfile(serializeProfile(DEFAULT_PROFILE)).version===1,'範本無法回讀');let rejected=false;try{parseProfile(JSON.stringify({...DEFAULT_PROFILE,people:[{name:'王小明'}]}));}catch{rejected=true;}assert(rejected,'範本接受個案名單');assert(rawStorage()===storageBefore,'localStorage/sessionStorage 被變動');return '個案欄位拒絕；Web Storage 未變動';
  });
  const resources=(performance.getEntriesByType('resource')as PerformanceResourceTiming[]).map(r=>r.name);
  const external=resources.filter(url=>{try{const u=new URL(url);return u.origin!==location.origin&&!['blob:','data:'].includes(u.protocol);}catch{return false;}});
  await test('外部連線限制與本機資產來源',async()=>{assert(external.length===0,'有外部資產要求');assert(violations.length===0,'發生 CSP 違規');assert(fetchLog.some(u=>u.includes('fonts/')),'未實際載入本機中文字型');return `${resources.length} 筆頁面資源、${fetchLog.length} 次 fetch 均為本機來源；CSP 禁止外部來源，未做作業系統封包擷取`;});
  const summary={started,finished:new Date().toISOString(),passed:checks.filter(c=>c.passed).length,total:checks.length,checks,resources,fetchLog,cspViolations:violations,storageUnchanged:rawStorage()===storageBefore,note:'使用新建的合成文件；此驗收不是實務正確率，也不是作業系統實體斷網或封包擷取。worker 受同源 CSP 限制。'};
  report.textContent=JSON.stringify(summary,null,2);report.dataset.status=summary.passed===summary.total?'passed':'failed';progress.textContent=`完成：${summary.passed}/${summary.total} 通過`;run.disabled=false;
};
