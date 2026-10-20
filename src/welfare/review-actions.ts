import { createManualFinding,findingsToEdits } from './engine';
import type { WorkspaceDocument } from './session';
import type { FindingAction,WelfareFinding } from './types';
import { revokeOutputApproval } from './output-scan';

export interface ReviewState { filter:'all'|'pending'; page:number; selectedId?:string }
export interface ReviewHistoryEntry { findings:WelfareFinding[]; affectedIds:string[] }
export interface FindingChange { action?:FindingAction; category?:string; generalized?:string }
export interface SameWordPreview {
  documentId:string; revision:number; sourceId:string; original:string; originalCategory:string; personId?:string;
  ids:string[]; excluded:number; change:FindingChange;
}
export const REVIEW_PAGE_SIZE=30;
export function reviewState(doc:WorkspaceDocument):ReviewState {return doc.reviewState??=( {filter:'all',page:0} );}
export function touchReview(doc:WorkspaceDocument):void {doc.reviewRevision=(doc.reviewRevision??0)+1;revokeOutputApproval(doc);}
export function resetReview(doc:WorkspaceDocument):void {delete doc.reviewHistory;delete doc.reviewState;doc.reviewConfirmed=false;touchReview(doc);}

function commit(doc:WorkspaceDocument,next:WelfareFinding[],affectedIds:string[]):void {
  findingsToEdits(doc.document.text,next);
  const history=doc.reviewHistory??=[];
  history.push({findings:doc.findings.map(f=>({...f})),affectedIds});if(history.length>20)history.shift();
  doc.findings=next;doc.reviewConfirmed=false;touchReview(doc);
}
function changedFinding(doc:WorkspaceDocument,f:WelfareFinding,change:FindingChange):WelfareFinding {
  const category=change.category??f.category;
  // Reuse engine label/span validation instead of maintaining another name policy.
  createManualFinding(doc.document.text,f.start,f.end,category,[]);
  const next={...f,action:change.action??f.action,category,generalized:change.generalized??f.generalized,reviewed:false};
  if(f.source!=='person'&&!f.personId)next.replacement=`[${category}]`;
  if(next.action==='generalize'&&change.generalized===undefined&&!next.generalized)next.generalized='（已概括）';
  return next;
}
export function changeFinding(doc:WorkspaceDocument,id:string,change:FindingChange):void {
  const f=doc.findings.find(f=>f.id===id);if(!f)throw new Error('項目已變動，請重新選取');
  const next=changedFinding(doc,f,change);
  if(next.action===f.action&&next.category===f.category&&next.generalized===f.generalized)return;
  commit(doc,doc.findings.map(f=>f.id===id?next:f),[id]);
}
export function previewSameWord(doc:WorkspaceDocument,id:string,change:FindingChange):SameWordPreview {
  const f=doc.findings.find(f=>f.id===id);if(!f)throw new Error('項目已變動，請重新選取');
  const matches=doc.findings.filter(other=>other.original===f.original);
  const selected=matches.filter(other=>other.category===f.category&&other.personId===f.personId);
  const next=doc.findings.map(other=>selected.includes(other)?changedFinding(doc,other,change):other);
  findingsToEdits(doc.document.text,next);
  return {documentId:doc.id,revision:doc.reviewRevision??0,sourceId:id,original:f.original,originalCategory:f.category,personId:f.personId,ids:selected.map(f=>f.id),excluded:matches.length-selected.length,change:{...change}};
}
export function applySameWord(doc:WorkspaceDocument,preview:SameWordPreview|undefined):void {
  if(!preview)throw new Error('請先預覽同詞影響，再確認套用');
  if(doc.id!==preview.documentId||(doc.reviewRevision??0)!==preview.revision)throw new Error('文件或覆核已變動，請重新預覽');
  const current=previewSameWord(doc,preview.sourceId,preview.change);
  if(current.original!==preview.original||current.originalCategory!==preview.originalCategory||current.personId!==preview.personId||current.ids.join('\0')!==preview.ids.join('\0'))throw new Error('項目已變動，請重新預覽');
  commit(doc,doc.findings.map(f=>current.ids.includes(f.id)?changedFinding(doc,f,current.change):f),current.ids);
}
export function undoReview(doc:WorkspaceDocument):boolean {
  const previous=doc.reviewHistory?.pop();if(!previous)return false;
  const current=new Map(doc.findings.map(f=>[f.id,f]));const affected=new Set(previous.affectedIds);
  doc.findings=previous.findings.map(f=>({...f,reviewed:!affected.has(f.id)&&(current.get(f.id)?.reviewed??false)}));
  doc.reviewConfirmed=false;touchReview(doc);return true;
}
export function setReviewed(doc:WorkspaceDocument,ids:string[],reviewed:boolean):void {
  const selected=new Set(ids);for(const f of doc.findings)if(selected.has(f.id))f.reviewed=reviewed;
  doc.reviewConfirmed=false;touchReview(doc);
}
export function confirmFullReview(doc:WorkspaceDocument,checked:boolean):void {
  if(checked&&doc.findings.some(f=>!f.reviewed))throw new Error('請先核對所有項目');
  doc.reviewConfirmed=checked;touchReview(doc);
}
export function addManualRanges(doc:WorkspaceDocument,ranges:{start:number;end:number}[],category:string,source:'manual'|'field'='manual'):number {
  let next=[...doc.findings];const ids:string[]=[];
  for(const range of ranges){
    if(source==='field')next=next.filter(f=>!(range.start<f.end&&range.end>f.start));
    const f={...createManualFinding(doc.document.text,range.start,range.end,category,next),source,reviewed:false};
    ids.push(f.id);next.push(f);
  }
  if(!ranges.length)throw new Error('找不到尚未標記的相同文字');
  const changedIds=[...ids,...doc.findings.filter(f=>!next.includes(f)).map(f=>f.id)];
  commit(doc,next.sort((a,b)=>a.start-b.start),changedIds);return ranges.length;
}
export function reviewPage(doc:WorkspaceDocument,start=0,end=doc.document.text.length) {
  const state=reviewState(doc);const scoped=doc.findings.filter(f=>f.start>=start&&f.end<=end);
  const filtered=scoped.filter(f=>state.filter==='all'||!f.reviewed);
  const pages=Math.max(1,Math.ceil(filtered.length/REVIEW_PAGE_SIZE));state.page=Math.min(Math.max(0,state.page),pages-1);
  return {scoped,filtered,shown:filtered.slice(state.page*REVIEW_PAGE_SIZE,(state.page+1)*REVIEW_PAGE_SIZE),pages,pending:doc.findings.filter(f=>!f.reviewed).length,total:doc.findings.length};
}
