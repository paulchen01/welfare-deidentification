import { applyEdits } from '../core/redactor';
import { CATEGORIES,type TextEdit } from '../core/types';
import { detectWelfare,findingsToEdits } from './engine';
import { PERSON_ROLES } from './policies';
import type { ShareEntry } from './export';
import type { WelfareFinding } from './types';

export interface OutputSpan { start:number; end:number }
export interface OutputScan {
  text:string; edits:TextEdit[]; signature:string; confirmedKeeps:OutputSpan[];
  risks:WelfareFinding[]; knownOriginalsRemain:boolean; reviewComplete:boolean;
}

// Full exact states, deliberately memory-only. No short hash and no string allowlist.
const approvals=new WeakMap<ShareEntry,string>();
const approvalRevisions=new WeakMap<ShareEntry,number>();
const safeLabels=new Set<string>([...CATEGORIES,'居留證','銀行帳號','案號','通報編號','病歷號','公文文號','安置編號',
  '機構','學校','醫院','村里','職業','健康資訊','保護資訊','經濟資訊','日期','年齡','金額','車牌','LINE ID']);
function isStockMarker(value:string):boolean {
  const label=value.slice(1,-1);
  return value===`[${label}]`&&(safeLabels.has(label)||[...PERSON_ROLES,'人物'].some(role=>
    label.startsWith(role)&&/^[A-Z]+$/.test(label.slice(role.length))));
}

/** Changes to judgment/configuration matter even when the resulting text is identical. */
export function outputStateSignature(entry:ShareEntry):string {
  return JSON.stringify({
    id:entry.id,text:entry.document.text,format:entry.document.format,fileName:entry.document.fileName,
    findings:entry.findings,reviewConfirmed:entry.reviewConfirmed,revision:entry.reviewRevision??0,
    mode:entry.mode,report:entry.report,config:entry.detectionConfig??{purpose:'ai',groupId:entry.id,people:[]},
  });
}

export function inspectOutput(entry:ShareEntry):OutputScan {
  const signature=outputStateSignature(entry);
  if(approvals.has(entry)&&approvals.get(entry)!==signature)revokeOutputApproval(entry);
  const edits=findingsToEdits(entry.document.text,entry.findings);
  const editsByStart=new Map(edits.map(edit=>[edit.start,edit]));
  const text=applyEdits(entry.document.text,edits);
  const confirmedKeeps:OutputSpan[]=[];
  const stockMarkers:OutputSpan[]=[];
  let delta=0;
  for(const finding of [...entry.findings].sort((a,b)=>a.start-b.start)){
    if(finding.action==='keep'){
      if(finding.reviewed)confirmedKeeps.push({start:finding.start+delta,end:finding.end+delta});
    }else{
      const edit=editsByStart.get(finding.start)!;
      if(finding.action==='mask'&&isStockMarker(edit.replacement))
        stockMarkers.push({start:finding.start+delta,end:finding.start+delta+edit.replacement.length});
      delta+=edit.replacement.length-(edit.end-edit.start);
    }
  }
  // Scan the actual output, preserving marker boundaries between labeled fields.
  // Only hits wholly inside our finite stock placeholders are inert; custom
  // category labels (including identifiers inside brackets) remain candidates.
  const config=entry.detectionConfig??{purpose:'ai' as const,groupId:entry.id,people:[]};
  const risks=detectWelfare(text,config).filter(f=>f.original.trim()&&
    !confirmedKeeps.some(keep=>keep.start<=f.start&&keep.end>=f.end)&&
    !stockMarkers.some(marker=>marker.start<=f.start&&marker.end>=f.end));
  const hidden=entry.findings.filter(f=>f.action!=='keep').map(f=>f.original).filter(s=>s.length>=2);
  return {text,edits,signature,confirmedKeeps,risks,knownOriginalsRemain:hidden.some(value=>text.includes(value)),
    reviewComplete:entry.reviewConfirmed&&entry.findings.every(f=>f.reviewed)};
}

function assertReviewAndResidual(scan:OutputScan):void {
  if(!scan.reviewComplete)throw new Error('請完成全文與格式限制覆核，再匯出或複製');
  if(scan.knownOriginalsRemain)throw new Error('輸出仍有已選定遮罩的原值殘留，請檢查其他出現位置或概括內容');
}
export function isOutputApproved(entry:ShareEntry,scan=inspectOutput(entry)):boolean {
  return scan.signature===outputStateSignature(entry)&&approvals.get(entry)===scan.signature;
}
export function approveOutputRisks(entry:ShareEntry,displayedSignature:string):void {
  const scan=inspectOutput(entry);
  if(scan.signature!==displayedSignature)throw new Error('文件或覆核已變動，請重新檢查新增疑似項目');
  assertReviewAndResidual(scan);
  if(scan.risks.length){
    approvalRevisions.set(entry,(approvalRevisions.get(entry)??0)+1);
    approvals.set(entry,scan.signature);
  }
}
export function revokeOutputApproval(entry:ShareEntry):void {
  approvals.delete(entry);approvalRevisions.set(entry,(approvalRevisions.get(entry)??0)+1);
}
export function assertOutputReady(entry:ShareEntry):OutputScan {
  const scan=inspectOutput(entry);assertReviewAndResidual(scan);
  if(scan.risks.length&&!isOutputApproved(entry,scan))throw new Error('輸出有新增疑似項目，請回到匯出頁檢查並明確確認適合目前用途');
  return scan;
}

/** Retain the live source object across awaits; callers must check before releasing bytes. */
export function captureOutputGuard(entry:ShareEntry,signal?:AbortSignal):()=>void {
  const signature=outputStateSignature(entry),document=entry.document,handle=document.handle;
  if(approvals.has(entry)&&approvals.get(entry)!==signature)revokeOutputApproval(entry);
  const approvalRevision=approvalRevisions.get(entry)??0;
  const check=()=>{
    if(signal?.aborted)throw new DOMException('已取消輸出','AbortError');
    if(entry.document!==document||document.handle!==handle||outputStateSignature(entry)!==signature||
      (approvalRevisions.get(entry)??0)!==approvalRevision)
      throw new Error('文件或覆核已變動，已停止輸出；請重新檢查');
  };
  check();return check;
}
