import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { mountWelfareApp } from '../../src/welfare/app';
describe('bulk people interface',()=>{
  beforeEach(()=>{vi.spyOn(window,'scrollTo').mockImplementation(()=>{});});afterEach(()=>vi.restoreAllMocks());
  const setup=()=>{const host=document.createElement('div');const app=mountWelfareApp(host);app.addText('小惠接受服務。');return {host,app};};
  const click=(host:HTMLElement,label:string)=>{const b=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label);expect(b,label).toBeDefined();b!.click();};
  const enter=(host:HTMLElement,text:string)=>{const input=host.querySelector<HTMLTextAreaElement>('[aria-label="批次人物清單"]');expect(input).not.toBeNull();input!.value=text;input!.dispatchEvent(new Event('input',{bubbles:true}));};
  it('previews and requires an explicit import before adding unconfirmed aliases',()=>{
    const {host,app}=setup();enter(host,'陳美惠\t母親\t小惠、陳女士');
    expect(app.session.people).toHaveLength(0);click(host,'預覽人物清單');expect(host.textContent).toContain('預計新增 1 人');expect(app.session.people).toHaveLength(0);
    click(host,'確認加入人物');expect(app.session.people).toHaveLength(1);expect(app.session.people[0].confirmed).toBe(false);
    expect(app.session.active!.findings.find(f=>f.original==='小惠')?.replacement).toBe('[姓名]');
  });
  it('shows row errors and blocks all additions until corrected and previewed again',()=>{
    const {host,app}=setup();enter(host,'王怡安\n陳美惠\t不明角色');click(host,'預覽人物清單');
    expect(host.textContent).toContain('第 2 行');expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='確認加入人物')?.disabled).toBe(true);expect(app.session.people).toHaveLength(0);
    enter(host,'王怡安\n陳美惠');expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='確認加入人物')?.disabled).toBe(true);
    click(host,'預覽人物清單');click(host,'確認加入人物');expect(app.session.people).toHaveLength(2);
  });
  it('discards a pending preview when changing documents and after clearing',()=>{
    const {host,app}=setup();enter(host,'王怡安');click(host,'預覽人物清單');app.addText('第二案普通文字');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="批次人物清單"]')?.value).toBe('');
    expect(app.session.people).toHaveLength(0);app.clear();expect(host.textContent).not.toContain('王怡安');
  });
});
