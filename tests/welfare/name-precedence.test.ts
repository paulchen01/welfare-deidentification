import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectWelfare, proposePeople, renderText } from '../../src/welfare/engine';
import { mountWelfareApp } from '../../src/welfare/app';
import type { Person } from '../../src/welfare/types';
const person=(patch:Partial<Person>={}):Person=>({id:'mother',groupId:'case',name:'陳美惠',aliases:[],role:'母親',confirmed:true,...patch});
const analyse=(text:string,people:Person[])=>detectWelfare(text,{purpose:'ai',groupId:'case',people});
const output=(text:string,people:Person[])=>renderText(text,analyse(text,people));
const source='案母：陳美惠陪同會談。';
describe('confirmed roster name versus temporary name proposal',()=>{
  it('preserves the corrected confirmed name and following narrative',()=>{
    expect(proposePeople(source,'case')[0]?.name).toBe('陳美惠陪同會談');
    const fs=analyse(source,[person()]);
    expect(renderText(source,fs)).toBe('案母：[母親A]陪同會談。');expect(fs[0]?.personId).toBe('mother');expect(fs[0]?.original).toBe('陳美惠');
  });
  it('applies the same narrow precedence to an explicit confirmed alias',()=>{
    expect(output(source,[person({name:'陳芳',aliases:['陳美惠']})])).toBe('案母：[母親A]陪同會談。');
  });
  it('keeps the temporary long proposal when the short roster entry is unconfirmed',()=>{
    expect(output(source,[person({confirmed:false})])).toBe('案母：[姓名]。');
  });
  it.each([false,true])('preserves the explicit longer roster name (confirmed=%s)',confirmed=>{
    const people=[person(),person({id:'long',name:'陳美惠芳',role:'父親',confirmed})];
    expect(output('姓名：陳美惠芳。',people)).toBe(confirmed?'姓名：[父親A]。':'姓名：[姓名]。');
  });
  it('preserves an explicit longer roster alias even if it matches a temporary proposal',()=>{
    expect(output(source,[person(),person({id:'long',name:'周芳',aliases:['陳美惠陪同會談'],confirmed:false})])).toBe('案母：[姓名]。');
  });
  it('does not promote a confirmed alias shared with an unconfirmed roster person',()=>{
    const people=[person({name:'陳芳',aliases:['陳美惠']}),person({id:'unconfirmed',name:'周芳',aliases:['陳美惠'],confirmed:false})];
    const fs=analyse(source,people);expect(renderText(source,fs)).toBe('案母：[姓名]。');expect(fs[0]?.personId).toBeUndefined();
  });
  it('does not promote a same-name person confirmed in another case',()=>{
    expect(output(source,[person({groupId:'other'})])).toBe('案母：[姓名]。');
  });
  it('preserves a different longer proposal whose start precedes the confirmed substring',()=>{
    const text='案母：陳美惠陪同會談；姓名：周陳美惠。';
    expect(output(text,[person()])).toBe('案母：[母親A]陪同會談；姓名：[姓名]。');
  });
  it('does not treat a custom identifier rule categorized as name as a temporary proposal',()=>{
    const text='姓名：陳美惠123。';
    const fs=detectWelfare(text,{purpose:'ai',groupId:'case',people:[person()],customRules:[{id:'rule',label:'姓名',prefix:'陳美惠',minDigits:3,maxDigits:3}]});
    expect(renderText(text,fs)).toBe('姓名：[姓名]。');expect(fs[0]?.source).toBe('rule');
  });
  it('retains foreign-name boundaries rather than promoting a letter prefix',()=>{
    expect(output('姓名：Alexandra。',[person({name:'Alex'})])).toBe('姓名：[姓名]。');
  });
});
describe('correcting a proposed name in the real person editor',()=>{
  afterEach(()=>vi.restoreAllMocks());
  it('renders the corrected confirmed role with the original narrative after editing',()=>{
    vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
    const host=document.createElement('div');const app=mountWelfareApp(host);app.addText(source);
    expect(app.session.people[0]?.name).toBe('陳美惠陪同會談');
    const name=host.querySelector<HTMLInputElement>('.person-editor input')!;name.value='陳美惠';name.dispatchEvent(new Event('change',{bubbles:true}));
    const role=host.querySelector<HTMLSelectElement>('.person-editor select')!;role.value='母親';role.dispatchEvent(new Event('change',{bubbles:true}));
    const confirmed=host.querySelector<HTMLInputElement>('.person-editor input[type="checkbox"]')!;confirmed.checked=true;confirmed.dispatchEvent(new Event('change',{bubbles:true}));
    expect(app.session.people[0]).toMatchObject({name:'陳美惠',role:'母親',confirmed:true});
    app.go('review');expect(host.textContent).toContain('案母：[母親A]陪同會談。');
    expect(app.session.active!.findings.every(f=>!f.reviewed)).toBe(true);expect(app.session.active!.reviewConfirmed).toBe(false);
  });
});
