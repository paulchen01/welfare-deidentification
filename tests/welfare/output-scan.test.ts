import { afterEach,describe,expect,it,vi } from 'vitest';
import JSZip from 'jszip';
import { inspectOutput,approveOutputRisks,isOutputApproved,revokeOutputApproval } from '../../src/welfare/output-scan';
import { createShareDocument,buildShareArchive,copyShareText } from '../../src/welfare/export';
import { WorkspaceSession } from '../../src/welfare/session';
import { changeFinding,undoReview,confirmFullReview,setReviewed } from '../../src/welfare/review-actions';
import { importBulkPeople,previewBulkPeople } from '../../src/welfare/bulk-people';

function document(text='短詞；0987654321；說明') {
  const session=new WorkspaceSession();
  const doc=session.add({fileName:'合成案例.txt',format:'txt',text,handle:null},{nativeAllowed:true,issues:[]});
  doc.findings=[
    {id:'mask',start:0,end:2,original:'短詞',category:'說明',source:'manual',action:'mask',replacement:'[已概括的情境]',reviewed:true},
    {id:'keep',start:3,end:13,original:'0987654321',category:'手機',source:'manual',action:'keep',replacement:'[手機]',reviewed:true},
    {id:'new',start:14,end:16,original:'說明',category:'說明',source:'manual',action:'generalize',replacement:'[說明]',generalized:'姓名：陳示範。電話：0987654321',reviewed:true},
  ];
  doc.reviewConfirmed=true;
  return {session,doc};
}
afterEach(()=>vi.restoreAllMocks());
describe('second scan of exact output',()=>{
  it('maps reviewed keep ranges after variable-length edits without whitelisting equal values elsewhere',()=>{
    const {doc}=document();const scan=inspectOutput(doc);
    expect(scan.confirmedKeeps).toHaveLength(1);
    const keep=scan.confirmedKeeps[0];
    expect(scan.text.slice(keep.start,keep.end)).toBe('0987654321');
    expect(keep.start).toBe('[已概括的情境]；'.length);
    expect(scan.risks.some(f=>f.original==='陳示範'&&f.source==='person')).toBe(true);
    expect(scan.risks.filter(f=>f.original==='0987654321')).toHaveLength(1);
    expect(scan.risks.find(f=>f.original==='0987654321')!.start).toBeGreaterThan(keep.end);
  });
  it('does not treat unchecked keeps as previously approved',()=>{
    const {doc}=document();doc.findings[1].reviewed=false;
    expect(inspectOutput(doc).confirmedKeeps).toHaveLength(0);
    expect(inspectOutput(doc).risks.filter(f=>f.original==='0987654321')).toHaveLength(2);
    expect(()=>approveOutputRisks(doc,inspectOutput(doc).signature)).toThrow(/覆核/);
  });
  it('requires no additional approval for ordinary generated field markers or a reviewed keep',async()=>{
    const {session}=document();
    const doc=session.add({fileName:'測試.txt',format:'txt',text:'機構：示範中心。電話：0987654321',handle:null},{nativeAllowed:true,issues:[]});
    doc.findings.forEach(f=>{f.reviewed=true;if(f.original==='0987654321')f.action='keep';});doc.reviewConfirmed=true;
    expect(inspectOutput(doc).risks).toHaveLength(0);
    await expect(createShareDocument(doc,1)).resolves.toBeDefined();
  });
  it('scans identifiers embedded in custom category markers',()=>{
    const {doc}=document();doc.findings[0].replacement='[聯絡電話：0911222333]';
    expect(inspectOutput(doc).risks.some(f=>f.original==='0911222333')).toBe(true);
  });
  it('uses same-case aliases and institution rules, and excludes other cases',()=>{
    const {session,doc}=document();doc.findings[2].generalized='小範、他案人、DEMO1234';
    session.people=[{id:'p',groupId:doc.groupId,name:'陳示範',aliases:['小範'],role:'服務對象',confirmed:true},
      {id:'other',groupId:'other',name:'他案人',aliases:[],role:'服務對象',confirmed:true}];
    session.profile.rules=[{id:'r',label:'機構代碼',prefix:'DEMO',minDigits:4,maxDigits:4}];
    expect(inspectOutput(doc).risks.map(f=>f.original)).toEqual(['小範','DEMO1234']);
  });
  it('binds approval to exact findings, config, output and monotonic review revision',()=>{
    const {session,doc}=document();const scan=inspectOutput(doc);
    approveOutputRisks(doc,scan.signature);expect(isOutputApproved(doc)).toBe(true);
    doc.findings[2].generalized+='。';expect(isOutputApproved(doc)).toBe(false);
    doc.findings[2].generalized=scan.text.slice(scan.text.indexOf('姓名'));
    approveOutputRisks(doc,inspectOutput(doc).signature);
    session.people.push({id:'new',groupId:doc.groupId,name:'陳示範',aliases:[],role:'服務對象',confirmed:true});
    expect(isOutputApproved(doc)).toBe(false);
    approveOutputRisks(doc,inspectOutput(doc).signature);
    changeFinding(doc,'new',{generalized:'其他情境'});undoReview(doc);
    setReviewed(doc,doc.findings.map(f=>f.id),true);confirmFullReview(doc,true);
    expect(isOutputApproved(doc)).toBe(false);
  });
  it.each(['reanalyse','remove','clear'] as const)('invalidates an approval on %s even if an old object remains referenced',action=>{
    const {session,doc}=document();approveOutputRisks(doc,inspectOutput(doc).signature);
    if(action==='reanalyse')session.reanalyse(doc);else if(action==='remove')session.remove(doc.id);else session.clear();
    expect(isOutputApproved(doc)).toBe(false);
  });
  it('does not revive output approval when a failed person import rolls review data back',()=>{
    const {session,doc}=document();
    const second=session.add({fileName:'合成.txt',format:'txt',text:'一般內容',handle:null},{nativeAllowed:true,issues:[]});
    second.groupId=doc.groupId;
    approveOutputRisks(doc,inspectOutput(doc).signature);
    const preview=previewBulkPeople('林示範',session.people,doc.groupId);
    const reanalyse=session.reanalyse.bind(session);
    session.reanalyse=entry=>{if(entry===second)throw new Error('synthetic failure');reanalyse(entry);};
    expect(()=>importBulkPeople(session,doc.id,preview)).toThrow('synthetic failure');
    expect(isOutputApproved(doc)).toBe(false);
  });
  it('rejects an approval based on a stale displayed result',()=>{
    const {doc}=document();const signature=inspectOutput(doc).signature;doc.findings[2].generalized+='。';
    expect(()=>approveOutputRisks(doc,signature)).toThrow(/變動/);
  });
  it('exports without a redundant acknowledgement once an approved new risk is removed',async()=>{
    const {doc}=document();approveOutputRisks(doc,inspectOutput(doc).signature);
    doc.findings[2].generalized='一般情境';
    await expect(createShareDocument(doc,1)).resolves.toBeDefined();
  });
  it('never lets a risk acknowledgement bypass known-original residuals',async()=>{
    const {doc}=document();approveOutputRisks(doc,inspectOutput(doc).signature);
    doc.findings[2].generalized='短詞；電話：0911222333';
    expect(()=>approveOutputRisks(doc,inspectOutput(doc).signature)).toThrow(/殘留/);
    await expect(createShareDocument(doc,1)).rejects.toThrow(/殘留/);
  });
  it('gates single-file, archive and copy with the same explicit approval, without leaking values in the summary',async()=>{
    const {doc}=document();const writer=vi.fn(async(_text:string)=>{});
    await expect(createShareDocument(doc,1)).rejects.toThrow(/新增疑似/);
    await expect(buildShareArchive([doc],'ai')).rejects.toThrow(/新增疑似/);
    await expect(copyShareText(doc,1,writer)).rejects.toThrow(/新增疑似/);
    expect(writer).not.toHaveBeenCalled();
    approveOutputRisks(doc,inspectOutput(doc).signature);
    await expect(createShareDocument(doc,1)).resolves.toBeDefined();
    await copyShareText(doc,1,writer);expect(writer).toHaveBeenCalledWith(inspectOutput(doc).text);
    const zip=await JSZip.loadAsync(await (await buildShareArchive([doc],'ai')).arrayBuffer());
    const summary=await zip.file('處理摘要.json')!.async('string');
    for(const value of ['短詞','陳示範','0987654321','合成案例'])expect(summary).not.toContain(value);
  });
  it('honors pre-cancellation for all delivery paths',async()=>{
    const {doc}=document();approveOutputRisks(doc,inspectOutput(doc).signature);
    const controller=new AbortController();controller.abort();const options={signal:controller.signal};
    await expect(createShareDocument(doc,1,options)).rejects.toMatchObject({name:'AbortError'});
    await expect(buildShareArchive([doc],'ai',options)).rejects.toMatchObject({name:'AbortError'});
    const writer=vi.fn(async()=>{});await expect(copyShareText(doc,1,writer,options)).rejects.toMatchObject({name:'AbortError'});
    expect(writer).not.toHaveBeenCalled();
  });
  it('retains the live entry when copying text so a mutation at the await boundary blocks the clipboard write',async()=>{
    const {doc}=document();approveOutputRisks(doc,inspectOutput(doc).signature);doc.mode='native';
    approveOutputRisks(doc,inspectOutput(doc).signature);
    const writer=vi.fn(async()=>{});const pending=copyShareText(doc,1,writer);
    doc.findings[2].generalized='已修改';await expect(pending).rejects.toThrow(/變動/);
    expect(writer).not.toHaveBeenCalled();
  });
  it('rechecks earlier documents after the final asynchronous zip step',async()=>{
    const {doc}=document();approveOutputRisks(doc,inspectOutput(doc).signature);
    const generate=JSZip.prototype.generateAsync;let calls=0;
    vi.spyOn(JSZip.prototype,'generateAsync').mockImplementation(function(this:JSZip,...args:Parameters<typeof generate>){
      calls++;doc.findings[2].generalized='changed';return generate.apply(this,args);
    } as typeof generate);
    await expect(buildShareArchive([doc],'ai')).rejects.toThrow(/變動/);expect(calls).toBe(1);
  });
  it.each(['remove','reorder','cancel'] as const)('rejects batch %s while compression is running',async action=>{
    const {doc}=document();approveOutputRisks(doc,inspectOutput(doc).signature);
    const other=document().doc;approveOutputRisks(other,inspectOutput(other).signature);
    const entries=[doc,other],controller=new AbortController();
    const generate=JSZip.prototype.generateAsync;
    vi.spyOn(JSZip.prototype,'generateAsync').mockImplementation(function(this:JSZip,...args:Parameters<typeof generate>){
      if(action==='remove')entries.pop();else if(action==='reorder')entries.reverse();else controller.abort();
      return generate.apply(this,args);
    } as typeof generate);
    await expect(buildShareArchive(entries,'ai',{signal:controller.signal})).rejects.toThrow(/變動|取消/);
  });
  it.each(['change','cancel','revoke','revoke-and-approve'] as const)('does not release native output on %s during generation',async action=>{
    const {doc}=document();doc.document.format='docx';doc.mode='native';approveOutputRisks(doc,inspectOutput(doc).signature);
    const safety=await import('../../src/welfare/document-safety');
    let finish!:(blob:Blob)=>void;const pendingBlob=new Promise<Blob>(resolve=>{finish=resolve;});
    const generate=vi.spyOn(safety,'generateSafeDocument').mockReturnValue(pendingBlob);
    const controller=new AbortController();const pending=createShareDocument(doc,1,{signal:controller.signal});
    await vi.waitFor(()=>expect(generate).toHaveBeenCalledOnce());
    if(action==='change')doc.findings[2].generalized='changed';
    else if(action==='cancel')controller.abort();
    else{
      revokeOutputApproval(doc);
      if(action==='revoke-and-approve')approveOutputRisks(doc,inspectOutput(doc).signature);
    }
    finish(new Blob(['synthetic']));
    await expect(pending).rejects.toThrow(/變動|取消/);
  });
});
