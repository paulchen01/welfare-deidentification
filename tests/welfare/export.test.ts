// @vitest-environment node
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildShareArchive, createShareDocument, type ShareEntry } from '../../src/welfare/export';

function entry(): ShareEntry {
  return {id:'local-1', document:{fileName:'王小明家訪.txt',format:'txt',text:'案主：王小明',handle:null},
    findings:[{id:'f1',start:3,end:6,original:'王小明',category:'姓名',source:'manual',action:'mask',replacement:'[服務對象A]',reviewed:true}],
    report:{nativeAllowed:true,issues:[]}, reviewConfirmed:true, mode:'text'};
}
describe('share output is independent from recovery data', () => {
  it('uses neutral filenames and contains no original names or recovery mappings', async () => {
    const result = await buildShareArchive([entry()], 'ai');
    const zip = await JSZip.loadAsync(await result.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(['文件-001.txt','處理摘要.json']);
    const all = await Promise.all(Object.values(zip.files).map((f) => f.async('string')));
    expect(all.join('\n')).not.toContain('王小明');
    expect(all.join('\n')).not.toContain('originalFileName');
    expect(all[0]).toBe('案主：[服務對象A]');
  });
  it('blocks export before complete user review', async () => {
    await expect(createShareDocument({...entry(), reviewConfirmed:false}, 1)).rejects.toThrow(/覆核/);
    const doc = entry(); doc.findings[0].reviewed = false;
    await expect(createShareDocument(doc, 1)).rejects.toThrow(/覆核/);
  });
  it('blocks unsupported original-format export but allows explicitly reviewed text', async () => {
    const doc = {...entry(), report:{nativeAllowed:false,issues:[{code:'hidden',severity:'block' as const,message:'有未涵蓋內容'}]}};
    await expect(createShareDocument({...doc,mode:'native'}, 1)).rejects.toThrow(/格式/);
    expect((await createShareDocument(doc, 1)).name).toBe('文件-001.txt');
  });
  it('rejects known private originals left elsewhere after masking', async () => {
    const doc = entry(); doc.document.text += '，王小明';
    await expect(createShareDocument(doc, 1)).rejects.toThrow(/殘留/);
  });
  it('blocks newly inserted phone numbers in generalized text before export', async () => {
    const doc = entry();
    doc.findings[0].action = 'generalize';
    doc.findings[0].generalized = '聯絡電話：0987654321';
    await expect(createShareDocument(doc, 1)).rejects.toThrow(/新增疑似/);
    await expect(buildShareArchive([doc], 'ai')).rejects.toThrow(/新增疑似/);
  });
  it('does not release an archive if review is revoked while it is generating', async () => {
    const doc = entry();
    const pending = buildShareArchive([doc], 'ai');
    doc.reviewConfirmed = false;
    await expect(pending).rejects.toThrow(/變動|覆核/);
  });
});
