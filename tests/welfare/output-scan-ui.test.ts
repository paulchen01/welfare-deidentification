import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { mountWelfareApp } from '../../src/welfare/app';
import { approveOutputRisks,inspectOutput } from '../../src/welfare/output-scan';
import { createManualFinding } from '../../src/welfare/engine';
import * as exporting from '../../src/welfare/export';

function fixture() {
  const host=document.createElement('div'),app=mountWelfareApp(host);
  app.addText('說明');
  const doc=app.session.active!;
  doc.findings=[{...createManualFinding('說明',0,2,'情境',[]),action:'generalize',generalized:'姓名：陳示範。電話：0987654321'}];
  doc.reviewConfirmed=true;app.go('export');return {host,app,doc};
}
const findButton=(host:HTMLElement,label:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===label)!;
beforeEach(()=>{vi.spyOn(window,'scrollTo').mockImplementation(()=>{});});
afterEach(()=>vi.restoreAllMocks());
describe('output second-scan interface',()=>{
  it('shows current checks, values and reasons then requires an explicit per-document acknowledgement',()=>{
    const {host}=fixture();
    expect(host.textContent).toContain('新增疑似項目：2');
    expect(host.textContent).toContain('陳示範');expect(host.textContent).toContain('0987654321');
    expect(host.textContent).toContain('理由');expect(host.textContent).toContain('已知原值');
    expect(findButton(host,'下載這份文件').disabled).toBe(true);
    expect(findButton(host,'下載分享包').disabled).toBe(true);
    expect(findButton(host,'複製目前文件').disabled).toBe(true);
    const box=host.querySelector<HTMLInputElement>('[data-output-approval]')!;
    box.checked=true;box.dispatchEvent(new Event('change'));
    expect(findButton(host,'下載這份文件').disabled).toBe(false);
    expect(findButton(host,'下載分享包').disabled).toBe(false);
    expect(findButton(host,'複製目前文件').disabled).toBe(false);
  });
  it('does not add an acknowledgement for ordinary output, or claim that native packaging was generated',()=>{
    const {host,app,doc}=fixture();
    doc.findings[0].generalized='一般情境';doc.document.format='docx';doc.mode='native';app.render();
    expect(host.querySelector('[data-output-approval]')).toBeNull();
    expect(host.textContent).toContain('尚未產生');
    expect(host.textContent).not.toContain('封裝檢查已通過');
  });
  it('invalidates the acknowledgement after format change and change back',()=>{
    const {host,app,doc}=fixture();doc.document.format='docx';approveOutputRisks(doc,inspectOutput(doc).signature);app.render();
    const select=host.querySelector<HTMLSelectElement>('.export-row select')!;
    select.value='native';select.dispatchEvent(new Event('change'));
    const second=host.querySelector<HTMLSelectElement>('.export-row select')!;
    second.value='text';second.dispatchEvent(new Event('change'));
    expect(findButton(host,'下載這份文件').disabled).toBe(true);
  });
  it.each(['view','active'] as const)('blocks delivery after a %s switch at the generation await boundary',async change=>{
    const {host,app,doc}=fixture();approveOutputRisks(doc,inspectOutput(doc).signature);app.render();
    const download=vi.spyOn(exporting,'downloadBlob').mockImplementation(()=>{});
    let resolve!:()=>void;const pause=new Promise<void>(r=>{resolve=r;});
    const original=exporting.createShareDocument;
    vi.spyOn(exporting,'createShareDocument').mockImplementation(async(...args)=>{const result=await original(...args);await pause;return result;});
    findButton(host,'下載這份文件').click();
    if(change==='view')app.view='review';else app.session.activeId='changed';
    resolve();await vi.waitFor(()=>expect(app.busy).toBe(false));
    expect(download).not.toHaveBeenCalled();
  });
  it('blocks copy after the source entry changes while text generation yields',async()=>{
    const {host,app,doc}=fixture();approveOutputRisks(doc,inspectOutput(doc).signature);app.render();
    const writer=vi.fn(async()=>{});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:writer}});
    findButton(host,'複製目前文件').click();doc.findings[0].generalized='changed';
    await vi.waitFor(()=>expect(app.busy).toBe(false));expect(writer).not.toHaveBeenCalled();
  });
});
