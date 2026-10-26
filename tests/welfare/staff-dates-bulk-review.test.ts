import { describe, expect, it } from 'vitest';
import { detectWelfare, renderText } from '../../src/welfare/engine';
import { WorkspaceSession } from '../../src/welfare/session';
import { changeMultipleFindings, confirmFullReview, reviewState, setReviewed, undoReview } from '../../src/welfare/review-actions';
import { assertOutputReady } from '../../src/welfare/output-scan';
import type { DetectionConfig, Person } from '../../src/welfare/types';

const people = (groupId: string): Person[] => [
  {id:'staff-1',name:'陳大文',role:'社工',groupId,aliases:[],confirmed:true},
  {id:'client-1',name:'王小明',role:'服務對象',groupId,aliases:[],confirmed:true},
];
const config = (purpose: DetectionConfig['purpose']='ai', persons=people('case')): DetectionConfig => ({
  purpose, groupId:'case', people:persons,
});
const setup = () => {
  const session=new WorkspaceSession();
  const doc=session.add({
    fileName:'synthetic.txt',format:'txt',
    text:'訪視日期：2026-10-20；社工：陳大文；案主：王小明。',handle:null
  },{nativeAllowed:true,issues:[]});
  session.people=people(doc.groupId);
  session.reanalyse(doc);
  return {session,doc};
};
describe('confirmed staff and chronological date suggestions',()=>{
  it('keeps confirmed staff and service dates but masks the client for AI collaboration',()=>{
    const text='訪視日期：2026-10-20；社工：陳大文；案主：王小明。';
    const fs=detectWelfare(text,config());
    expect(fs.find(f=>f.original==='陳大文')?.action).toBe('keep');
    expect(fs.find(f=>f.original==='2026-10-20')?.action).toBe('keep');
    expect(fs.find(f=>f.original==='王小明')?.action).toBe('mask');
    expect(renderText(text,fs)).toContain('社工：陳大文');
    expect(renderText(text,fs)).not.toContain('王小明');
    expect(fs.every(f=>!f.reviewed)).toBe(true);
  });
  it('never auto-keeps unconfirmed staff, conflicting client labels or ambiguous same-name owners',()=>{
    const text='社工：陳大文；案主：陳大文。';
    const staff=people('case')[0];
    expect(detectWelfare(text,config('ai',[staff])).filter(f=>f.original==='陳大文').every(f=>f.action==='mask')).toBe(true);
    expect(detectWelfare('社工：陳大文。',config('ai',[{...staff,confirmed:false}])).find(f=>f.original==='陳大文')?.action).toBe('mask');
    expect(detectWelfare('陳大文',config('ai',[staff,{...staff,id:'client-2',role:'服務對象'}])).find(f=>f.original==='陳大文')?.action).toBe('mask');
  });
  it('protects birthday and incident dates while keeping service dates; public use generalizes ordinary dates',()=>{
    const text='訪視日期：2026-10-20；出生日期：2012-03-06；案發日期：2026-04-02。';
    const decisions=(purpose:DetectionConfig['purpose'])=>detectWelfare(text,config(purpose)).filter(f=>f.category==='日期').map(f=>f.action);
    expect(decisions('ai')).toEqual(['keep','mask','mask']);
    expect(decisions('internal')).toEqual(['keep','mask','keep']);
    expect(decisions('public')).toEqual(['generalize','mask','mask']);
    expect(detectWelfare(text,config('public')).find(f=>f.original==='2026-10-20')?.generalized).toBe('2026年10月中旬');
  });
});
describe('batch selection does not bypass individual safety gates',()=>{
  it('uses one undo step and invalidates changed findings and full-document approval',()=>{
    const {doc}=setup();
    const chosen=doc.findings.filter(f=>f.original==='陳大文'||f.original==='2026-10-20').map(f=>f.id);
    expect(chosen).toHaveLength(2);
    setReviewed(doc,doc.findings.map(f=>f.id),true);
    confirmFullReview(doc,true);
    expect(doc.reviewConfirmed).toBe(true);
    expect(changeMultipleFindings(doc,chosen,'mask')).toBe(2);
    expect(doc.reviewConfirmed).toBe(false);
    expect(doc.findings.filter(f=>chosen.includes(f.id)).every(f=>!f.reviewed&&f.action==='mask')).toBe(true);
    expect(()=>assertOutputReady(doc)).toThrow('全文');
    expect(doc.reviewHistory).toHaveLength(1);
    expect(undoReview(doc)).toBe(true);
    expect(doc.findings.filter(f=>chosen.includes(f.id)).every(f=>f.action==='keep'&&!f.reviewed)).toBe(true);
  });
  it('does not silently unreview unchanged selections',()=>{
    const {doc}=setup();const date=doc.findings.find(f=>f.category==='日期')!;
    const client=doc.findings.find(f=>f.original==='王小明')!;
    setReviewed(doc,[date.id,client.id],true);
    expect(changeMultipleFindings(doc,[date.id,client.id],'mask')).toBe(1);
    expect(doc.findings.find(f=>f.id===client.id)?.reviewed).toBe(true);
    expect(doc.findings.find(f=>f.id===date.id)?.reviewed).toBe(false);
  });
  it('refuses mass release of client names, birthdates, or other high-risk data',()=>{
    const {doc}=setup();
    const client=doc.findings.find(f=>f.original==='王小明')!;
    const before=doc.findings.map(f=>({...f}));
    expect(()=>changeMultipleFindings(doc,[client.id],'keep')).toThrow('批次保留');
    expect(()=>changeMultipleFindings(doc,[client.id],'generalize')).toThrow('概化建議');
    expect(()=>changeMultipleFindings(doc,['missing-document-id'],'mask')).toThrow('項目已變動');
    expect(doc.findings).toEqual(before);
    expect(doc.reviewHistory).toBeUndefined();
  });
  it('supports safe staff/date retention only after manual identity verification',()=>{
    const {doc}=setup();
    const ids=doc.findings.filter(f=>['陳大文','2026-10-20'].includes(f.original)).map(f=>f.id);
    changeMultipleFindings(doc,ids,'mask');
    expect(changeMultipleFindings(doc,ids,'keep')).toBe(2);
    const {doc:unconfirmed}=setup();
    unconfirmed.detectionConfig?.people.forEach(p=>p.confirmed=false);
    const name=unconfirmed.findings.find(f=>f.original==='陳大文')!;
    expect(()=>changeMultipleFindings(unconfirmed,[name.id],'keep')).toThrow('批次保留');
  });
  it('selecting every item does not mark items as reviewed or permit export',()=>{
    const {doc}=setup();
    reviewState(doc).selectedIds=doc.findings.map(f=>f.id);
    expect(reviewState(doc).selectedIds).toHaveLength(doc.findings.length);
    expect(doc.findings.every(f=>!f.reviewed)).toBe(true);
    expect(()=>assertOutputReady(doc)).toThrow('全文');
  });
});
