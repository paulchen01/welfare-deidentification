import JSZip from 'jszip';
import type { LoadedDocument, TextEdit } from '../core/types';
import { applyEdits } from '../core/redactor';
import { findingsToEdits } from './engine';
import type { WelfareFinding, Purpose } from './types';
import type { FormatSafetyReport } from './document-safety';
import { makeRecoveryDocument, type RecoveryBundle } from './vault';

export interface ShareEntry {
  id:string; document:LoadedDocument; findings:WelfareFinding[];
  report:FormatSafetyReport; reviewConfirmed:boolean; mode:'native'|'text';
}
export interface ShareDocument { name:string; blob:Blob; text:string; edits:TextEdit[] }

export function reviewedEdits(entry: ShareEntry): TextEdit[] {
  if (!entry.reviewConfirmed || entry.findings.some((f) => !f.reviewed)) throw new Error('請完成全文與格式限制覆核，再匯出或複製');
  const edits = findingsToEdits(entry.document.text, entry.findings);
  const output = applyEdits(entry.document.text, edits);
  // This is a residual check, not a claim to detect previously unknown identifiers.
  const hidden = entry.findings.filter((f) => f.action !== 'keep').map((f) => f.original).filter((s) => s.length >= 2);
  if (hidden.some((value) => output.includes(value))) throw new Error('輸出仍有已選定遮罩的原值殘留，請檢查其他出現位置或概括內容');
  return edits;
}

export async function createShareDocument(entry: ShareEntry, index: number): Promise<ShareDocument> {
  if (!Number.isInteger(index) || index < 1 || index > 10) throw new Error('批次文件序號無效');
  const edits = reviewedEdits(entry);
  const text = applyEdits(entry.document.text, edits);
  const ext = entry.mode === 'text' ? 'txt' : entry.document.format;
  const name = `文件-${String(index).padStart(3,'0')}.${ext}`;
  if (entry.mode === 'native' && !entry.report.nativeAllowed) throw new Error('此文件含未涵蓋內容，不能匯出原格式；請覆核限制後選文字版本');
  const blob = entry.mode === 'text' || ['txt','md'].includes(entry.document.format)
    ? new Blob([text], {type:'text/plain;charset=utf-8'})
    : await (await import('./document-safety')).generateSafeDocument(entry.document, edits, entry.report);
  return {name, blob, text, edits};
}

export async function buildShareArchive(entries: ShareEntry[], purpose: Purpose): Promise<Blob> {
  if (!entries.length || entries.length > 10) throw new Error('每批須為 1–10 份文件');
  const zip = new JSZip();
  const results = [];
  for (const [i, entry] of entries.entries()) {
    const result = await createShareDocument(entry, i + 1);
    zip.file(result.name, await result.blob.arrayBuffer());
    results.push({file:result.name, format:entry.mode === 'text' ? 'txt' : entry.document.format,
      redactions:result.edits.length, unreviewed:0, textOnly:entry.mode === 'text',
      formatLimitations:entry.report.issues.length});
  }
  zip.file('處理摘要.json', JSON.stringify({version:'welfare-0.1.0', purpose, documents:results,
    notice:'已完成人工覆核；不代表所有間接辨識風險均已排除。本摘要不含原檔名與還原資料。'}, null, 2));
  const bytes = await zip.generateAsync({type:'uint8array', compression:'DEFLATE'});
  return new Blob([new Uint8Array(bytes)], {type:'application/zip'});
}

export async function buildRecoveryBundle(entries: ShareEntry[]): Promise<RecoveryBundle> {
  if (!entries.length || entries.length > 10) throw new Error('每批須為 1–10 份文件');
  const documents = [];
  for (const entry of entries) {
    documents.push(await makeRecoveryDocument(entry.id, entry.document.fileName, entry.document.format,
      entry.document.text, reviewedEdits(entry)));
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
