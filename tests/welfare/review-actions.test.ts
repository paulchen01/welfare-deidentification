// @vitest-environment node
import { describe,expect,it } from 'vitest';
import { WorkspaceSession } from '../../src/welfare/session';
import { addManualRanges,applySameWord,changeFinding,previewSameWord,setReviewed,undoReview } from '../../src/welfare/review-actions';
const setup=()=>{const session=new WorkspaceSession();const doc=session.add({fileName:'synthetic.txt',format:'txt',text:'電話0912345678；電話0912345678；藍色小屋',handle:null},{nativeAllowed:true,issues:[]});return {session,doc};};
describe('review operation safety',()=>{
  it('removes detached-document undo history after clear and remove',()=>{
    for(const operation of ['clear','remove']){const {session,doc}=setup();changeFinding(doc,doc.findings[0].id,{action:'keep'});
      if(operation==='clear')session.clear();else session.remove(doc.id);
      expect(undoReview(doc)).toBe(false);
    }
  });
  it('rejects missing, cross-document and outdated same-word previews',()=>{
    const {session,doc}=setup();expect(()=>applySameWord(doc,undefined)).toThrow('先預覽');
    const preview=previewSameWord(doc,doc.findings[0].id,{action:'keep'});
    const second=session.add({fileName:'second.txt',format:'txt',text:'電話0912345678',handle:null},{nativeAllowed:true,issues:[]});
    expect(()=>applySameWord(second,preview)).toThrow('重新預覽');setReviewed(doc,[doc.findings[0].id],true);
    expect(()=>applySameWord(doc,preview)).toThrow('重新預覽');expect(doc.findings.every(f=>f.action==='mask')).toBe(true);
  });
  it('bounds history at 20 operations and keeps revision monotonic through undo and reanalysis',()=>{
    const {session,doc}=setup();let previous=doc.reviewRevision!;
    for(let i=0;i<25;i++){changeFinding(doc,doc.findings[0].id,{category:`分類${i}`});expect(doc.reviewRevision).toBeGreaterThan(previous);previous=doc.reviewRevision!;}
    expect(doc.reviewHistory).toHaveLength(20);for(let i=0;i<20;i++){expect(undoReview(doc)).toBe(true);expect(doc.reviewRevision).toBeGreaterThan(previous);previous=doc.reviewRevision!;}
    expect(undoReview(doc)).toBe(false);expect(doc.findings[0].category).toBe('分類4');session.reanalyse(doc);expect(doc.reviewRevision).toBeGreaterThan(previous);expect(doc.reviewHistory).toBeUndefined();expect(doc.reviewState).toBeUndefined();
  });
  it('undo does not revive earlier reviewed snapshots of later-invalidated items',()=>{
    const {doc}=setup();doc.findings.forEach(f=>f.reviewed=true);doc.reviewConfirmed=true;
    changeFinding(doc,doc.findings[0].id,{action:'keep'});changeFinding(doc,doc.findings[1].id,{category:'聯絡資訊'});
    undoReview(doc);undoReview(doc);expect(doc.findings.every(f=>!f.reviewed)).toBe(true);expect(doc.reviewConfirmed).toBe(false);
  });
  it('manual additions and field replacement are atomic and undo without restoring approvals',()=>{
    const {doc}=setup();const start=doc.document.text.indexOf('藍色小屋');const initial=doc.findings.map(f=>({...f}));
    expect(()=>addManualRanges(doc,[{start,end:start+4},{start:0,end:5}],'人工標記')).toThrow('重疊');expect(doc.findings).toEqual(initial);expect(doc.reviewHistory).toBeUndefined();
    addManualRanges(doc,[{start:0,end:12}],'欄位','field');expect(doc.findings.some(f=>f.source==='field')).toBe(true);undoReview(doc);expect(doc.findings.map(f=>f.original)).toEqual(initial.map(f=>f.original));expect(doc.findings.every(f=>!f.reviewed)).toBe(true);
  });
});
