import { describe, expect, it } from 'vitest';
import { previewBulkPeople, importBulkPeople } from '../../src/welfare/bulk-people';
import { WorkspaceSession } from '../../src/welfare/session';
const add=(session:WorkspaceSession,text='普通文字')=>session.add({fileName:'synthetic.txt',format:'txt',text,handle:null},{nativeAllowed:true,issues:[]});
describe('bulk people preview and transaction',()=>{
  it('previews names and explicit roles and aliases without confirming identities',()=>{
    const preview=previewBulkPeople('王怡安\n陳美惠\t母親\t小惠、陳女士',[],'g');
    expect(preview.errors).toEqual([]);expect(preview.duplicates).toEqual([]);
    expect(preview.additions).toEqual([{name:'王怡安',role:'待確認',aliases:[]},{name:'陳美惠',role:'母親',aliases:['小惠','陳女士']}]);
  });
  it('skips exact same-case and repeated names, preserving existing confirmed aliases',()=>{
    const session=new WorkspaceSession();const doc=add(session);const other=add(session);
    session.people=[{id:'p',groupId:doc.groupId,name:'王怡安',role:'母親',aliases:['小安'],confirmed:true},{id:'o',groupId:other.groupId,name:'林秀英',role:'母親',aliases:[],confirmed:true}];
    const preview=previewBulkPeople('王怡安\t母親\t新別名\n林秀英\n林秀英',session.people,doc.groupId);
    expect(preview.duplicates.map(r=>r.line)).toEqual([1,3]);expect(preview.additions).toHaveLength(1);
    expect(importBulkPeople(session,doc.id,preview)).toBe(1);
    expect(session.people.find(p=>p.id==='p')?.aliases).toEqual(['小安']);
    expect(session.people.filter(p=>p.name==='林秀英')).toHaveLength(2);
    expect(session.people.at(-1)?.confirmed).toBe(false);
  });
  it.each(['有效姓名\n壞角色\t不存在','有效姓名\n\t母親','有效姓名\t母親\t別名\t多餘欄位','名'.repeat(121),'姓名\t母親\t'+Array.from({length:21},(_,i)=>'別名'+i).join('、'),'姓名\t母親\t'+ '別'.repeat(121),'姓名\u202e'])('rejects invalid rows without partially importing: %s',(text)=>{
    const session=new WorkspaceSession();const doc=add(session);const preview=previewBulkPeople(text,session.people,doc.groupId);
    expect(preview.errors.length).toBeGreaterThan(0);expect(()=>importBulkPeople(session,doc.id,preview)).toThrow();expect(session.people).toEqual([]);
  });
  it('limits input to 100 physical lines and keeps line numbers on blank rows',()=>{
    expect(previewBulkPeople(Array.from({length:101},(_,i)=>'人物'+i).join('\n'),[],'g').errors.length).toBeGreaterThan(0);
    expect(previewBulkPeople('王怡安\n\n陳怡安',[],'g').errors[0]?.line).toBe(2);
    expect(previewBulkPeople('王怡安\r\n陳怡安\r\n',[],'g').additions).toHaveLength(2);
  });
  it('invalidates all documents of the affected case after importing while preserving another case',()=>{
    const session=new WorkspaceSession();const a=add(session,'王怡安');const b=add(session,'王怡安');b.groupId=a.groupId;const other=add(session,'普通文字');
    for(const doc of session.documents){doc.reviewConfirmed=true;doc.findings.forEach(f=>{f.reviewed=true;});}
    const preview=previewBulkPeople('王怡安',session.people,a.groupId);importBulkPeople(session,a.id,preview);
    expect([a,b].every(d=>!d.reviewConfirmed&&d.findings.every(f=>!f.reviewed))).toBe(true);
    expect(a.findings[0]?.replacement).toBe('[姓名]');expect(other.reviewConfirmed).toBe(true);
  });
  it('accepts the exact row, name and alias limits without merging alias values',()=>{
    const aliases=Array.from({length:20},(_,i)=>String(i)+'別'.repeat(118));
    const first='名'.repeat(120)+'\t\t'+aliases.join('、');
    const preview=previewBulkPeople([first,...Array.from({length:99},(_,i)=>'人物'+i)].join('\n'),[],'g');
    expect(preview.errors).toEqual([]);expect(preview.additions).toHaveLength(100);expect(preview.additions[0].aliases).toEqual(aliases);
  });
  it.each([false,true])('keeps an imported alias ambiguous regardless of owner ordering (%s)',(reverse)=>{
    const session=new WorkspaceSession();const doc=add(session,'小安');const other=add(session,'小安');
    session.people=[{id:'confirmed',groupId:doc.groupId,name:'王怡安',aliases:['小安'],role:'母親',confirmed:true},{id:'other',groupId:other.groupId,name:'林怡安',aliases:['小安'],role:'母親',confirmed:true}];
    importBulkPeople(session,doc.id,previewBulkPeople('陳怡安\t父親\t小安',session.people,doc.groupId));
    if(reverse)session.people.reverse();session.reanalyseAll();
    expect(doc.findings[0]?.replacement).toBe('[姓名]');expect(doc.findings[0]?.personId).toBeUndefined();expect(other.findings[0]?.personId).toBe('other');
  });
  it('rolls back people and review state if reanalysis fails after a valid preview',()=>{
    const session=new WorkspaceSession();const doc=add(session,'王怡安');const second=add(session,'王怡安');second.groupId=doc.groupId;
    for(const d of [doc,second])d.reviewConfirmed=true;
    const originalFindings=doc.findings;const preview=previewBulkPeople('王怡安',session.people,doc.groupId);
    const reanalyse=session.reanalyse.bind(session);session.reanalyse=(d)=>{if(d===second)throw new Error('synthetic failure');reanalyse(d);};
    expect(()=>importBulkPeople(session,doc.id,preview)).toThrow('synthetic failure');
    expect(session.people).toEqual([]);expect(doc.findings).toBe(originalFindings);expect(doc.reviewConfirmed).toBe(true);expect(second.reviewConfirmed).toBe(true);
  });
  it('rejects a preview after grouping or people change without partial import',()=>{
    const session=new WorkspaceSession();const doc=add(session);const preview=previewBulkPeople('王怡安',session.people,doc.groupId);
    doc.groupId='changed';expect(()=>importBulkPeople(session,doc.id,preview)).toThrow();expect(session.people).toEqual([]);
    doc.groupId=preview.groupId;session.people.push({id:'new',groupId:doc.groupId,name:'王怡安',aliases:[],role:'待確認',confirmed:false});
    expect(()=>importBulkPeople(session,doc.id,preview)).toThrow();expect(session.people).toHaveLength(1);
  });
});
