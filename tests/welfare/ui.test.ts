import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { mountWelfareApp } from '../../src/welfare/app';
describe('welfare workflow interface', () => {
  beforeEach(()=>{vi.spyOn(window,'scrollTo').mockImplementation(()=>{});});
  afterEach(()=>{vi.restoreAllMocks();window.getSelection()?.removeAllRanges();});
  it('downloads a reviewed single file while another file remains unreviewed',async()=>{
    const exporting=await import('../../src/welfare/export');const download=vi.spyOn(exporting,'downloadBlob').mockImplementation(()=>{});
    const host=document.createElement('div');const app=mountWelfareApp(host);
    app.addText('電話0912345678');const first=app.session.active!;
    app.addText('另一份未覆核文件');app.go('export');
    const buttons=()=>[...host.querySelectorAll<HTMLButtonElement>('button')].filter(b=>b.textContent==='下載這份文件');
    expect(buttons()[0]?.disabled).toBe(true);
    first.findings.forEach(f=>{f.reviewed=true;});first.reviewConfirmed=true;app.render();
    expect(buttons()[0]?.disabled).toBe(false);expect(buttons()[1]?.disabled).toBe(true);
    buttons()[0]!.click();await vi.waitFor(()=>expect(app.busy).toBe(false));
    expect(download).toHaveBeenCalledOnce();expect(download.mock.calls[0][1]).toBe('文件-001.txt');
    expect(await download.mock.calls[0][0].text()).not.toContain('0912345678');
  });
  it('does not download an in-flight single export after clearing the workspace',async()=>{
    const exporting=await import('../../src/welfare/export');const download=vi.spyOn(exporting,'downloadBlob').mockImplementation(()=>{});
    let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;});
    const original=exporting.createShareDocument;
    vi.spyOn(exporting,'createShareDocument').mockImplementation(async(...args)=>{await pending;return original(...args);});
    const host=document.createElement('div');const app=mountWelfareApp(host);app.addText('普通文字');
    app.session.active!.reviewConfirmed=true;app.go('export');
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='下載這份文件')!.click();
    app.clear();finish();await pending;await new Promise(resolve=>setTimeout(resolve,10));
    expect(download).not.toHaveBeenCalled();expect(app.session.documents).toHaveLength(0);
  });
  it('does not revive a later cancelled import when an older import resolves',async()=>{
    const parser=await import('../../src/welfare/document-safety');const parsed=vi.spyOn(parser,'parseSafeDocument');
    let resolveA!:(text:string)=>void;let resolveB!:(text:string)=>void;
    const pendingA=new Promise<string>(resolve=>{resolveA=resolve;});const pendingB=new Promise<string>(resolve=>{resolveB=resolve;});
    const a=new File(['a'],'a.txt');Object.defineProperty(a,'text',{value:()=>pendingA});
    const b=new File(['b'],'b.txt');Object.defineProperty(b,'text',{value:()=>pendingB});
    const host=document.createElement('div');const app=mountWelfareApp(host);
    app.addFiles([a]);await vi.waitFor(()=>expect(parsed).toHaveBeenCalledTimes(1));
    app.clear();app.addFiles([b]);await vi.waitFor(()=>expect(parsed).toHaveBeenCalledTimes(2));
    resolveA('案主：王小明。');await parsed.mock.results[0].value;await Promise.resolve();
    app.clear();resolveB('案主：陳美惠。');await parsed.mock.results[1].value;await Promise.resolve();
    expect(app.session.documents).toHaveLength(0);expect(app.session.people).toHaveLength(0);
    expect(app.view).toBe('input');expect(app.busy).toBe(false);
  });
  it('removing one case person preserves another case and its confirmed aliases',()=>{
    const host=document.createElement('div');const app=mountWelfareApp(host);
    app.addText('案主：王小明。');const first=app.session.active!;
    app.addText('案主：陳美惠。小惠接受服務。');const second=app.session.active!;
    const other=app.session.people.find(p=>p.groupId===second.groupId)!;
    other.aliases=['小惠'];other.confirmed=true;app.session.reanalyseAll();
    expect(second.findings.some(f=>f.original==='小惠'&&f.source==='person')).toBe(true);
    app.session.activeId=first.id;app.go('people');
    [...host.querySelectorAll('.person-editor button')].find(b=>b.textContent==='移除')!.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    expect(app.session.people).toContain(other);
    expect(second.findings.some(f=>f.original==='小惠'&&f.source==='person')).toBe(true);
    expect(second.reviewConfirmed).toBe(false);
  });
  it('gates export until reviewed and clears case state', () => {
    const host = document.createElement('div'); document.body.append(host);
    const app = mountWelfareApp(host);
    app.addText('電話：0912-345-678。');
    expect(app.session.documents).toHaveLength(1);
    app.go('export');
    const exportButton = [...host.querySelectorAll('button')].find((b) => b.textContent === '下載分享包');
    expect(exportButton?.disabled).toBe(true);
    app.clear();
    expect(app.session.documents).toHaveLength(0);
    expect(app.rawInput).toBe('');
    expect(host.textContent).not.toContain('0912-345-678'); host.remove();
  });
  it('renders source as text, never markup', () => {
    const host = document.createElement('div');
    const app = mountWelfareApp(host);
    app.addText('<img src=x onerror="alert(1)"> 電話0912345678'); app.go('review');
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x'); host.remove();
  });
  it('enables sharing only after both finding and full-text confirmations',()=>{
    const host=document.createElement('div');const app=mountWelfareApp(host);app.addText('電話0912345678');app.go('review');
    const setCheck=(text:string)=>{const label=[...host.querySelectorAll('label')].find(l=>l.textContent?.includes(text))!;const box=label.querySelector('input')!;box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));};
    setCheck('逐項核對此檢視範圍');setCheck('重讀處理後全文');app.go('export');
    expect([...host.querySelectorAll('button')].find(b=>b.textContent==='下載分享包')?.disabled).toBe(false);
    app.session.setPurpose('public');app.render();
    expect([...host.querySelectorAll('button')].find(b=>b.textContent==='下載分享包')?.disabled).toBe(true);
  });
  it('preserves a selected text range until manual marking is captured',async()=>{
    const host=document.createElement('div');document.body.append(host);const app=mountWelfareApp(host);app.addText('住在藍色小屋，電話0912345678');app.go('review');
    const pre=host.querySelector('[aria-label="原文內容"]')!;const range=document.createRange();range.setStart(pre.firstChild!,2);range.setEnd(pre.firstChild!,6);window.getSelection()!.addRange(range);
    [...host.querySelectorAll('button')].find(b=>b.textContent==='標記反白範圍')!.click();
    await vi.waitFor(()=>expect(app.busy).toBe(false));
    expect(app.session.active!.findings.some(f=>f.source==='manual'&&f.original==='藍色小屋')).toBe(true);host.remove();
  });
  it('maps selection in a later PDF page to the full document offsets',async()=>{
    const host=document.createElement('div');document.body.append(host);const app=mountWelfareApp(host);const text='第一頁。\n第二頁藍色小屋';
    const d=app.session.add({fileName:'mock.pdf',format:'pdf',text,handle:null,layout:{kind:'pdf',pages:[{width:600,height:800,items:[{start:0,end:4,x:0,y:0,fontSize:10,width:40}]},{width:600,height:800,items:[{start:5,end:text.length,x:0,y:0,fontSize:10,width:70}]}]}},{nativeAllowed:true,issues:[]});
    d.reviewScope='1';app.go('review');const pre=host.querySelector('[aria-label="原文內容"]')!;const range=document.createRange();range.setStart(pre.firstChild!,3);range.setEnd(pre.firstChild!,7);window.getSelection()!.addRange(range);
    [...host.querySelectorAll('button')].find(b=>b.textContent==='標記反白範圍')!.click();await vi.waitFor(()=>expect(app.busy).toBe(false));
    const f=d.findings.find(f=>f.source==='manual');expect(f?.original).toBe('藍色小屋');expect(f?.start).toBe(8);host.remove();
  });
});
