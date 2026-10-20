import { describe, expect, it } from 'vitest';
import { detectWelfare, renderText } from '../../src/welfare/engine';
import type { Person } from '../../src/welfare/types';
const findings = (text:string, people:Person[] = []) => detectWelfare(text,{purpose:'ai',groupId:'case',people});
describe('context-scoped Taiwan identifiers',()=>{
  it('masks labeled plates, LINE accounts and checksum-checked business numbers',()=>{
    const text='車牌：ABC-1234；車號 AB-1234；LINE ID：Ab_9.x-y；LINE帳號：Demo.User；統一編號：04595257；統編 12345678。';
    const fs=findings(text);
    expect(fs.map(f=>[f.category,f.original])).toEqual([['車牌','ABC-1234'],['車牌','AB-1234'],['LINE ID','Ab_9.x-y'],['LINE ID','Demo.User'],['統編','04595257'],['統編','12345678']]);
    expect(fs.every(f=>!f.reviewed && f.action==='mask')).toBe(true);
    expect(fs.find(f=>f.original==='12345678')?.message).toMatch(/檢核未通過|疑似誤字/);
    expect(fs.find(f=>f.original==='04595257')?.message).toMatch(/檢核通過/);
    expect(fs.find(f=>f.category==='車牌')?.message).toMatch(/非完整|無法保證/);
    expect(renderText(text,fs)).not.toContain('Ab_9.x-y');
  });
  it('leaves ordinary codes and unlabeled eight-digit numbers alone',()=>{
    const text='代碼 ABC-1234；計畫 Ab_9.x-y；BASELINE ID: Abc123；數量 04595257、12345678；2026-10-21。';
    expect(findings(text).filter(f=>['車牌','LINE ID','統編'].includes(f.category))).toEqual([]);
  });
  it('rejects missing, overlong or malformed values without partial matches',()=>{
    for(const text of ['LINE ID：；','LINE ID：._-','LINE ID：'+ 'a'.repeat(21),'LINE ID：user@demo','車牌：2026-10-21','車牌：AB-123456789','統編：123456789','LINE帳號：\n下一欄']){
      expect(findings(text).filter(f=>['車牌','LINE ID','統編'].includes(f.category)),text).toEqual([]);
    }
  });
  it('prioritizes explicit LINE account labels over generic numeric bank accounts',()=>{
    expect(findings('LINE帳號：12345678').map(f=>[f.category,f.original])).toEqual([['LINE ID','12345678']]);
  });
  it('keeps common plate orientations and LINE case unchanged',()=>{
    for(const value of ['ABC-1234','1234-AB','AB-123','123-ABC','ab-1234'])expect(findings('車號：'+value).find(f=>f.category==='車牌')?.original).toBe(value);
    expect(findings('LINE ID: Mixed.Case_1-x')[0]?.original).toBe('Mixed.Case_1-x');
  });
});
describe('conservative identity linking',()=>{
  it('does not assign a confirmed identity to an alias also owned by an unconfirmed person',()=>{
    const people:Person[]=[{id:'a',groupId:'case',name:'王怡安',aliases:['小安'],role:'母親',confirmed:true},{id:'b',groupId:'case',name:'陳怡安',aliases:['小安'],role:'待確認',confirmed:false}];
    const f=findings('小安',people)[0];
    expect(f.replacement).toBe('[姓名]');expect(f.personId).toBeUndefined();expect(f.message).toContain('歧義');
  });
});
