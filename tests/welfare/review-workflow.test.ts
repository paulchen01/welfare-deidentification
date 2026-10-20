import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { mountWelfareApp } from '../../src/welfare/app';
import type { WelfareFinding } from '../../src/welfare/types';

const hosts:HTMLElement[]=[];
function setup(text='電話0912345678；電話0912345678；住在藍色小屋。') {
  const host=document.createElement('div');document.body.append(host);hosts.push(host);
  const app=mountWelfareApp(host);app.addText(text);app.go('review');return {host,app,doc:app.session.active!};
}
function click(host:HTMLElement,text:string){const b=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text);expect(b,`button ${text}`).toBeDefined();b!.click();}
function change(el:HTMLInputElement|HTMLSelectElement,value:string){el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}
function row(host:HTMLElement,id:string){return host.querySelector<HTMLElement>(`[data-finding-id="${id}"]`)!;}
function check(host:HTMLElement,text:string){const label=[...host.querySelectorAll('label')].find(l=>l.textContent?.includes(text))!;const box=label.querySelector('input')!;box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));}

describe('review efficiency and safety',()=>{
  beforeEach(()=>{vi.spyOn(window,'scrollTo').mockImplementation(()=>{});});
  afterEach(()=>{hosts.splice(0).forEach(h=>h.remove());vi.restoreAllMocks();window.getSelection()?.removeAllRanges();});
  it('counts the full document while filtering and paging only a bounded set of editors',()=>{
    const {host,app,doc}=setup(Array.from({length:75},()=> '電話0912345678').join('；'));
    expect(host.textContent).toContain('剩餘 75 項待核對');expect(host.querySelectorAll('[data-finding-id]').length).toBeLessThanOrEqual(30);
    click(host,'核對本批顯示的項目');expect(doc.findings.filter(f=>f.reviewed)).toHaveLength(30);
    expect(host.textContent).toContain('剩餘 45 項待核對');
    change(host.querySelector<HTMLSelectElement>('[aria-label="核對項目篩選"]')!,'pending');
    expect(host.querySelectorAll('[data-finding-id]')).toHaveLength(30);expect(host.textContent).toContain('全文 75 項');
    check(host,'重讀處理後全文');expect(doc.reviewConfirmed).toBe(false);
    app.go('export');expect([...host.querySelectorAll('button')].find(b=>b.textContent==='下載分享包')?.disabled).toBe(true);
  });
  it('changes categories with engine validation and retains confirmed person role markers',()=>{
    const {host,app,doc}=setup('案主：王小明；電話0912345678');const p=app.session.people[0];p.confirmed=true;p.role='案主';app.session.reanalyseAll();app.render();
    let person=doc.findings.find(f=>f.personId===p.id)!;const marker=person.replacement;
    change(row(host,person.id).querySelector<HTMLInputElement>('[aria-label="標記分類"]')!,'服務對象');
    person=doc.findings.find(f=>f.personId===p.id)!;expect(person.category).toBe('服務對象');expect(person.replacement).toBe(marker);
    const phone=doc.findings.find(f=>f.original==='0912345678')!;
    change(row(host,phone.id).querySelector<HTMLInputElement>('[aria-label="標記分類"]')!,'聯絡資訊');expect(doc.findings.find(f=>f.id===phone.id)?.replacement).toBe('[聯絡資訊]');
    change(row(host,phone.id).querySelector<HTMLInputElement>('[aria-label="標記分類"]')!,'[無效]');expect(doc.findings.find(f=>f.id===phone.id)?.category).toBe('聯絡資訊');expect(host.textContent).toContain('分類或角色標籤無效');
  });
  it('limits the range-confirm checkbox to displayed items instead of approving hidden batches',()=>{
    const {host,doc}=setup(Array.from({length:45},()=> '電話0912345678').join('；'));
    check(host,'逐項核對此檢視範圍');expect(doc.findings.filter(f=>f.reviewed)).toHaveLength(30);
    check(host,'重讀處理後全文');expect(doc.reviewConfirmed).toBe(false);
  });
  it('requires an explicit same-word preview then applies only the matching document, category and person identity',()=>{
    const {host,app,doc}=setup();const f=doc.findings[0];
    const other=app.session.add({fileName:'other.txt',format:'txt',text:'電話0912345678',handle:null},{nativeAllowed:true,issues:[]});app.session.activeId=doc.id;app.render();
    const target=row(host,f.id);const details=target.querySelector('details')!;details.open=true;
    const batchAction=details.querySelector<HTMLSelectElement>('[aria-label="批次處理方式"]')!;change(batchAction,'keep');
    const apply=[...details.querySelectorAll('button')].find(b=>b.textContent==='確認套用同詞設定')!;expect(apply.disabled).toBe(true);
    click(details,'預覽同詞影響');expect(details.textContent).toContain('影響 2 項');expect(f.action).toBe('mask');
    click(details,'確認套用同詞設定');expect(doc.findings.every(f=>f.action==='keep'&&!f.reviewed)).toBe(true);expect(other.findings[0].action).toBe('mask');
    click(host,'復原最近操作');expect(doc.findings.every(f=>f.action==='mask'&&!f.reviewed)).toBe(true);
  });
  it('excludes identical original text with another person identity or original category from batch preview',()=>{
    const {host,app,doc}=setup('甲甲 甲甲 甲甲 甲甲');
    doc.findings=[0,3,6,9].map((start,i)=>({id:`m${i}`,start,end:start+2,original:'甲甲',category:i===3?'其他':'姓名',personId:i===2?'p2':'p1',source:'person',replacement:i===2?'[人物B]':'[人物A]',action:'mask',reviewed:true} satisfies WelfareFinding));app.render();
    const details=row(host,'m0').querySelector('details')!;change(details.querySelector<HTMLSelectElement>('[aria-label="批次處理方式"]')!,'keep');click(details,'預覽同詞影響');
    expect(details.textContent).toContain('影響 2 項');expect(details.textContent).toContain('排除歧義 2 項');click(details,'確認套用同詞設定');
    expect(doc.findings.map(f=>f.action)).toEqual(['keep','keep','mask','mask']);expect(doc.findings.map(f=>f.personId)).toEqual(['p1','p1','p2','p1']);
    expect(doc.findings[2].replacement).toBe('[人物B]');
  });
  it('undoes category and single-item handling without restoring full review permission',()=>{
    const {host,doc}=setup();doc.findings.forEach(f=>f.reviewed=true);doc.reviewConfirmed=true;
    const f=doc.findings[0];change(row(host,f.id).querySelector<HTMLSelectElement>('[aria-label$="的處理方式"]')!,'keep');
    expect(doc.reviewConfirmed).toBe(false);click(host,'復原最近操作');const restored=doc.findings[0];expect(restored.action).toBe('mask');expect(restored.reviewed).toBe(false);expect(doc.reviewConfirmed).toBe(false);
  });
  it('undoes manual additions and prevents undo after purpose, people, reanalysis or clear changes',()=>{
    const {host,app,doc}=setup();change(host.querySelector<HTMLInputElement>('[aria-label="要遮罩的原文"]')!,'藍色小屋');click(host,'標記全部相同文字');
    expect(doc.findings.some(f=>f.original==='藍色小屋')).toBe(true);click(host,'復原最近操作');expect(doc.findings.some(f=>f.original==='藍色小屋')).toBe(false);
    for(const invalidate of [()=>app.session.setPurpose('public'),()=>{app.session.people.push({id:'p',groupId:doc.groupId,name:'藍色小屋',aliases:[],role:'人物',confirmed:false});app.session.reanalyse(doc);}]){
      change(row(host,doc.findings[0].id).querySelector<HTMLSelectElement>('[aria-label$="的處理方式"]')!,'keep');invalidate();app.render();expect([...host.querySelectorAll('button')].find(b=>b.textContent==='復原最近操作')?.disabled).toBe(true);
    }
    app.clear();expect(app.session.documents).toHaveLength(0);app.addText('電話0912345678');app.go('review');expect([...host.querySelectorAll('button')].find(b=>b.textContent==='復原最近操作')?.disabled).toBe(true);
  });
  it('keeps keyboard review and navigation focus usable across redraws and ignores input/IME/Delete',()=>{
    const {host,doc}=setup();const first=doc.findings[0],second=doc.findings[1];
    click(host,'下一項');expect(document.activeElement).toBe(row(host,first.id));
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));expect(document.activeElement).toBe(row(host,second.id));
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'r',bubbles:true}));expect(doc.findings[1].reviewed).toBe(true);expect(document.activeElement).toBe(row(host,second.id));
    const category=row(host,second.id).querySelector<HTMLInputElement>('[aria-label="標記分類"]')!;category.focus();
    for(const init of [{key:'r'},{key:'ArrowDown'},{key:'z',ctrlKey:true},{key:'Delete'}]){const event=new KeyboardEvent('keydown',{...init,bubbles:true,cancelable:true});category.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);}
    row(host,second.id).focus();const composing=new KeyboardEvent('keydown',{key:'r',isComposing:true,bubbles:true,cancelable:true});document.activeElement!.dispatchEvent(composing);expect(composing.defaultPrevented).toBe(false);expect(doc.findings[1].reviewed).toBe(true);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));expect(doc.findings[1].action).toBe('mask');
    const outside=new KeyboardEvent('keydown',{key:'r',bubbles:true,cancelable:true});host.dispatchEvent(outside);expect(outside.defaultPrevented).toBe(false);
  });
  it('adds accessible mark labels without changing source text or selection offsets across a mark',()=>{
    const {host,app,doc}=setup('住在藍色小屋，電話0912345678，再訪。');const pre=host.querySelector('[aria-label="原文內容"]')!;
    expect(pre.textContent).toBe(doc.document.text);expect(pre.querySelector('mark')?.getAttribute('aria-label')).toContain('待核對');
    const range=document.createRange();range.setStart(pre.lastChild!,1);range.setEnd(pre.lastChild!,3);window.getSelection()!.addRange(range);click(host,'標記反白範圍');
    expect(doc.findings.find(f=>f.original==='再訪')?.start).toBe(doc.document.text.indexOf('再訪'));expect(app.busy).toBe(false);
  });
  it('preserves a selected original range when a click ends on a marked span',()=>{
    const {host,doc}=setup();const pre=host.querySelector('[aria-label="原文內容"]')!;const mark=pre.querySelector('mark')!;
    const range=document.createRange();range.selectNodeContents(mark);window.getSelection()!.addRange(range);mark.click();
    expect(host.querySelector('[aria-label="原文內容"]')).toBe(pre);expect(window.getSelection()!.toString()).toBe(doc.findings[0].original);
  });
  it('retains keyboard focus when reviewing an item removes it from the pending filter',()=>{
    const {host,doc}=setup();change(host.querySelector<HTMLSelectElement>('[aria-label="核對項目篩選"]')!,'pending');click(host,'下一項');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'r',bubbles:true}));
    expect(doc.findings[0].reviewed).toBe(true);expect(document.activeElement).toBe(row(host,doc.findings[1].id));
  });
  it('returns focus to the selected item when undo disables its own last-history button',()=>{
    const {host,doc}=setup();click(host,'下一項');click(host,'下一項');const id=doc.findings[1].id;
    change(row(host,id).querySelector<HTMLSelectElement>('[aria-label$="的處理方式"]')!,'keep');click(host,'復原最近操作');
    expect([...host.querySelectorAll('button')].find(b=>b.textContent==='復原最近操作')?.disabled).toBe(true);expect(document.activeElement).toBe(row(host,id));
  });
  it('restores the next control after native Tab finishes a change-triggered redraw without cancelling Tab',async()=>{
    const {host,doc}=setup();const id=doc.findings[0].id;const category=row(host,id).querySelector<HTMLInputElement>('[aria-label="標記分類"]')!;category.focus();
    const tab=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});category.dispatchEvent(tab);expect(tab.defaultPrevented).toBe(false);
    change(category,'聯絡資訊');
    // Native sequential focus navigation completes after change, when the old control has been removed.
    (document.activeElement as HTMLElement).blur();await Promise.resolve();
    expect(document.activeElement).toBe(row(host,id).querySelector('[aria-label="聯絡資訊的處理方式"]'));
  });
  it('recovers focus after browser Tab completion following the microtask checkpoint',async()=>{
    const frames:FrameRequestCallback[]=[];vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{frames.push(callback);return frames.length;});
    const {host,doc}=setup();const id=doc.findings[0].id;const category=row(host,id).querySelector<HTMLInputElement>('[aria-label="標記分類"]')!;category.focus();
    category.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));change(category,'聯絡資訊');await Promise.resolve();
    (document.activeElement as HTMLElement).blur();for(const callback of frames.splice(0))callback(0);
    expect(document.activeElement).toBe(row(host,id).querySelector('[aria-label="聯絡資訊的處理方式"]'));
  });
  it('keeps the native Tab destination until change fires after keydown microtasks with BODY focused',async()=>{
    const {host,doc}=setup();const id=doc.findings[0].id;const category=row(host,id).querySelector<HTMLInputElement>('[aria-label="標記分類"]')!;category.focus();
    category.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));await Promise.resolve();category.blur();change(category,'聯絡資訊');
    expect(document.activeElement).toBe(row(host,id).querySelector('[aria-label="聯絡資訊的處理方式"]'));
  });
});
