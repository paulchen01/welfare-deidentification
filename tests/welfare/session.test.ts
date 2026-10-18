// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { WorkspaceSession } from '../../src/welfare/session';

describe('local session lifecycle', () => {
  it('isolates different documents and invalidates review after purpose changes', () => {
    const s = new WorkspaceSession();
    const first = s.add({fileName:'a.txt',format:'txt',text:'案主：王小明',handle:null}, {nativeAllowed:true,issues:[]});
    const second = s.add({fileName:'b.txt',format:'txt',text:'案主：王小明',handle:null}, {nativeAllowed:true,issues:[]});
    expect(first.findings.length).toBeGreaterThan(0);
    expect(first.groupId).not.toBe(second.groupId);
    first.findings.forEach((f) => f.reviewed = true); first.reviewConfirmed = true;
    s.setPurpose('public');
    expect(first.reviewConfirmed).toBe(false);
    expect(first.findings.every((f) => !f.reviewed)).toBe(true);
  });
  it('recomputes automatically labeled sensitive contexts after purpose changes',()=>{
    const s=new WorkspaceSession();s.setPurpose('internal');
    const d=s.add({fileName:'x.txt',format:'txt',text:'健康狀況：思覺失調症。',handle:null},{nativeAllowed:true,issues:[]});
    expect(d.findings[0].action).toBe('keep');
    s.setPurpose('ai');expect(d.findings[0].action).toBe('mask');
  });
  it('allows an unfinished new person row without crashing reanalysis',()=>{
    const s=new WorkspaceSession();const d=s.add({fileName:'x.txt',format:'txt',text:'電話0912345678',handle:null},{nativeAllowed:true,issues:[]});
    s.people.push({id:'draft',groupId:d.groupId,name:'',aliases:[],role:'服務對象',confirmed:false});
    expect(()=>s.reanalyseAll()).not.toThrow();expect(d.findings.length).toBeGreaterThan(0);
  });
  it('clear removes documents, aliases and restored text without persisting anything', () => {
    const s = new WorkspaceSession();
    s.add({fileName:'private.txt',format:'txt',text:'案主：王小明',handle:null}, {nativeAllowed:true,issues:[]});
    s.people.push({id:'x',groupId:'x',name:'別名',aliases:['小名'],role:'服務對象',confirmed:true});
    s.clear();
    expect(s.documents).toEqual([]);
    expect(s.people).toEqual([]);
    expect(s.active).toBeUndefined();
  });
  it('retains explicit manual spans but requires review when purpose changes', () => {
    const s = new WorkspaceSession();
    const d = s.add({fileName:'x.txt',format:'txt',text:'住在藍色房子',handle:null}, {nativeAllowed:true,issues:[]});
    d.findings.push({id:'m',start:2,end:6,original:'藍色房子',category:'其他',source:'manual',action:'mask',replacement:'[其他]',reviewed:true});
    s.setPurpose('public');
    expect(d.findings.some((f) => f.source === 'manual' && f.original === '藍色房子' && !f.reviewed)).toBe(true);
  });
});
