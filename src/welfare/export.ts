import JSZip from 'jszip';
import type { LoadedDocument, TextEdit } from '../core/types';
import { applyEdits } from '../core/redactor';
import type { WelfareFinding, Purpose, DetectionConfig } from './types';
import type { FormatSafetyReport } from './document-safety';
import { makeRecoveryDocument, type RecoveryBundle } from './vault';
import { assertOutputReady,captureOutputGuard } from './output-scan';

export interface ShareEntry {
  id:string; document:LoadedDocument; findings:WelfareFinding[];
  report:FormatSafetyReport; reviewConfirmed:boolean; mode:'native'|'text';
  reviewRevision?:number; detectionConfig?:DetectionConfig;
}
export interface ShareDocument { name:string; blob:Blob; text:string; edits:TextEdit[] }
export interface OutputOptions { signal?:AbortSignal; mode?:ShareEntry['mode'] }

export function reviewedEdits(entry: ShareEntry): TextEdit[] {
  return assertOutputReady(entry).edits;
}

export async function createShareDocument(entry: ShareEntry, index: number, options:OutputOptions={}): Promise<ShareDocument> {
  if (!Number.isInteger(index) || index < 1 || index > 10) throw new Error('批次文件序號無效');
  const check=captureOutputGuard(entry,options.signal);
  const edits = reviewedEdits(entry);
  const text = applyEdits(entry.document.text, edits);
  const mode=options.mode??entry.mode;
  const ext = mode === 'text' ? 'txt' : entry.document.format;
  const name = `文件-${String(index).padStart(3,'0')}.${ext}`;
  if (mode === 'native' && !entry.report.nativeAllowed) throw new Error('此文件含未涵蓋內容，不能匯出原格式；請覆核限制後選文字版本');
  let blob:Blob;
  if(mode==='text'||['txt','md'].includes(entry.document.format))blob=new Blob([text],{type:'text/plain;charset=utf-8'});
  else{
    const {generateSafeDocument}=await import('./document-safety');check();
    blob=await generateSafeDocument(entry.document,edits,entry.report);check();
  }
  check();
  return {name, blob, text, edits};
}

function captureBatchGuard(entries:ShareEntry[],signal?:AbortSignal):()=>void {
  const original=[...entries],checks=original.map(entry=>captureOutputGuard(entry,signal));
  return ()=>{
    if(entries.length!==original.length||entries.some((entry,i)=>entry!==original[i]))throw new Error('文件清單已變動，已停止輸出');
    checks.forEach(check=>check());
  };
}

export async function copyShareText(entry:ShareEntry,index:number,writeText:(text:string)=>Promise<void>,options:OutputOptions={}):Promise<void> {
  const check=captureOutputGuard(entry,options.signal);
  const data=await createShareDocument(entry,index,{...options,mode:'text'});
  check();
  await writeText(data.text);
  check();
}

export async function buildShareArchive(entries: ShareEntry[], purpose: Purpose, options:Pick<OutputOptions,'signal'>={}): Promise<Blob> {
  if (!entries.length || entries.length > 10) throw new Error('每批須為 1–10 份文件');
  const check=captureBatchGuard(entries,options.signal);
  entries.forEach(assertOutputReady);
  const zip = new JSZip();
  const results = [];
  for (const [i, entry] of entries.entries()) {
    const result = await createShareDocument(entry, i + 1,{signal:options.signal});check();
    const bytes=await result.blob.arrayBuffer();check();zip.file(result.name,bytes);
    const scan=assertOutputReady(entry);
    results.push({file:result.name, format:entry.mode === 'text' ? 'txt' : entry.document.format,
      redactions:result.edits.length, unreviewed:0, textOnly:entry.mode === 'text',
      confirmedKeeps:scan.confirmedKeeps.length,newSuspicions:scan.risks.length,
      newSuspicionsAcknowledged:scan.risks.length>0,
      knownOriginalCheck:'處理後文字已檢查',
      generatedFileCheck:entry.mode==='native'&&['docx','xlsx','pdf'].includes(entry.document.format)?'產檔後檢查已完成':'純文字輸出，無原格式封裝',
      formatLimitations:entry.report.issues.length});
  }
  zip.file('處理摘要.json', JSON.stringify({version:'welfare-0.1.0', purpose, documents:results,
    notice:'已完成人工覆核；不代表所有間接辨識風險均已排除。本摘要不含原檔名與還原資料。'}, null, 2));
  const bytes = await zip.generateAsync({type:'uint8array', compression:'DEFLATE'});
  check();
  return new Blob([new Uint8Array(bytes)], {type:'application/zip'});
}

export async function buildRecoveryBundle(entries: ShareEntry[],options:OutputOptions={}): Promise<RecoveryBundle> {
  if (!entries.length || entries.length > 10) throw new Error('每批須為 1–10 份文件');
  const documents = [];
  const check=captureBatchGuard(entries,options.signal);
  for (const entry of entries) {
    documents.push(await makeRecoveryDocument(entry.id, entry.document.fileName, entry.document.format,
      entry.document.text, reviewedEdits(entry)));
    check();
  }
  return {version:1, documents};
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  // Keep it alive while browsers start the download, then release it.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
