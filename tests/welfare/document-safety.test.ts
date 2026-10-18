import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDocx, toFile } from '../helpers/docx-builder';
import { buildXlsx, toXlsxFile } from '../helpers/xlsx-builder';
import { generateSafeDocument, inspectDocument, parseSafeDocument } from '../../src/welfare/document-safety';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
async function word(extra?: (zip: JSZip) => Promise<void> | void) {
  const zip = await JSZip.loadAsync(await buildDocx({ paragraphs: [['王小明', '聯絡資料']] }));
  await extra?.(zip);
  return toFile(await zip.generateAsync({ type: 'uint8array' }), 'private-source.docx');
}
async function excel(extra?: (zip: JSZip) => Promise<void> | void, numeric = false) {
  const zip = await JSZip.loadAsync(await buildXlsx({ sheets: [{ name: '秘密名單', rows: [['王小明', numeric ? 912345678 : '文字']] }] }));
  await extra?.(zip);
  return toXlsxFile(await zip.generateAsync({ type: 'uint8array' }), 'private-source.xlsx');
}
async function unpack(blob: Blob) { return JSZip.loadAsync(await blob.arrayBuffer()); }
const edit = { start: 0, end: 3, replacement: '[姓名1]' };

describe('native document safety', () => {
  it.each(['tests/fixtures/sample.docx'])('keeps ordinary bundled Word %s eligible for native export', async (path) => {
    const { document: doc, report } = await parseSafeDocument(toFile(new Uint8Array(readFileSync(path)), 'sample.docx'));
    expect(report.nativeAllowed, JSON.stringify(report.issues)).toBe(true);
    const output = await generateSafeDocument(doc, [], report);
    expect(output.size).toBeGreaterThan(0);
  });
  it('exports a clean Word on independent ZIP clones and removes metadata', async () => {
    const { document: doc, report } = await parseSafeDocument(await word((zip) => {
      zip.file('docProps/core.xml', '<cp:coreProperties xmlns:cp="urn:cp"><creator>秘密作者</creator></cp:coreProperties>');
    }));
    expect(report.nativeAllowed).toBe(true);
    const first = await unpack(await generateSafeDocument(doc, [edit], report));
    expect(await first.file('word/document.xml')!.async('string')).not.toContain('王小明');
    expect(first.file('docProps/core.xml')).toBeNull();
    const second = await unpack(await generateSafeDocument(doc, [], report));
    expect(await second.file('word/document.xml')!.async('string')).toContain('王小明');
    expect(await (doc.handle as { zip: JSZip }).zip.file('word/document.xml')!.async('string')).toContain('王小明');
    expect(await first.file('word/document.xml')!.async('string')).toContain('[姓名1]');
  });

  it.each([
    ['revision', `<w:del w:author="秘密作者"><w:r><w:delText>舊秘密</w:delText></w:r></w:del>`],
    ['textbox', '<w:txbxContent><w:p><w:r><w:t>秘密方塊</w:t></w:r></w:p></w:txbxContent>'],
    ['instruction', '<w:instrText>秘密指令</w:instrText>'],
    ['hidden', '<w:r><w:rPr><w:vanish/></w:rPr><w:t>隱藏秘密</w:t></w:r>'],
  ])('blocks Word %s, keeps extracted text accessible and ignores a forged passed report', async (_, payload) => {
    const { document: doc, report } = await parseSafeDocument(await word(async (zip) => {
      const xml = await zip.file('word/document.xml')!.async('string');
      zip.file('word/document.xml', xml.replace('<w:sectPr/>', payload + '<w:sectPr/>'));
    }));
    expect(doc.text).toContain('王小明');
    expect(report.nativeAllowed).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/秘密|private-source|王小明/);
    await expect(generateSafeDocument(doc, [], { nativeAllowed: true, issues: [] })).rejects.toThrow(/原格式/);
  });

  it.each(['word/comments.xml', 'word/footnotes.xml', 'word/media/image1.png', 'customXml/item1.xml', '_xmlsignatures/sig1.xml'])('blocks uncovered part %s', async (path) => {
    const { report } = await parseSafeDocument(await word((zip) => { zip.file(path, `<secret xmlns:w="${W}">秘密值</secret>`); }));
    expect(report.nativeAllowed).toBe(false);
    expect(report.issues.some((issue) => issue.severity === 'block')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('秘密值');
  });

  it('blocks external/hyperlink relations without disclosing the destination', async () => {
    const { report } = await parseSafeDocument(await word((zip) => {
      zip.file('word/_rels/document.xml.rels', '<Relationships><Relationship Id="r99" TargetMode="External" Type="hyperlink" Target="https://private.example/secret"/></Relationships>');
    }));
    expect(report.nativeAllowed).toBe(false);
    expect(JSON.stringify(report)).not.toContain('private.example');
  });

  it('exports text Excel, redacts shared strings and neutralizes worksheet names', async () => {
    const { document: doc, report } = await parseSafeDocument(await excel());
    expect(report.nativeAllowed).toBe(true);
    const output = await unpack(await generateSafeDocument(doc, [edit], report));
    expect(await output.file('xl/workbook.xml')!.async('string')).toContain('中性工作表1');
    const text = (await Promise.all(Object.values(output.files).filter((f) => !f.dir).map((f) => f.async('string')))).join('');
    expect(text).not.toContain('王小明');
    expect(text).not.toContain('秘密名單');
  });

  it('cleans unpreviewed Excel cell-style names and font names', async () => {
    const { document: doc, report } = await parseSafeDocument(await excel(async (zip) => {
      zip.file('xl/styles.xml', (await zip.file('xl/styles.xml')!.async('string')).replace('<font>', '<font><name val="陳隱名字型"/>').replace('</styleSheet>', '<cellStyles count="1"><cellStyle name="陳隱名專用" xfId="0" builtinId="0"/></cellStyles></styleSheet>'));
    }));
    expect(doc.text).not.toContain('陳隱名');
    expect(report.nativeAllowed).toBe(true);
    const output = await unpack(await generateSafeDocument(doc, [edit], report));
    const styles = await output.file('xl/styles.xml')!.async('string');
    expect(styles).not.toContain('陳隱名');
    expect(styles).toContain('中性樣式');
    expect(styles).toContain('Noto Sans TC');
    expect(JSON.stringify(report)).not.toContain('陳隱名');
  });

  it.each([
    ['custom table style', '<tableStyles count="1"><tableStyle name="陳隱名專用" count="0"/></tableStyles>'],
    ['custom default table style', '<tableStyles count="0" defaultTableStyle="陳隱名專用"/>'],
    ['unknown style field', '<cellStyles count="1"><cellStyle name="一般樣式" xfId="0" private="陳隱名專用"/></cellStyles>'],
    ['custom number format', '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;陳隱名專用&quot;"/></numFmts>'],
  ])('blocks unpreviewed Excel %s', async (_, payload) => {
    const { document: doc, report } = await parseSafeDocument(await excel(async (zip) => {
      zip.file('xl/styles.xml', (await zip.file('xl/styles.xml')!.async('string')).replace('</styleSheet>', payload + '</styleSheet>'));
    }));
    expect(report.nativeAllowed).toBe(false);
    expect(JSON.stringify(report)).not.toContain('陳隱名');
    await expect(generateSafeDocument(doc, [edit], { nativeAllowed: true, issues: [] })).rejects.toThrow(/原格式/);
  });

  it('keeps built-in Excel table-style defaults eligible without copying arbitrary labels', async () => {
    const { document: doc, report } = await parseSafeDocument(await excel(async (zip) => {
      zip.file('xl/styles.xml', (await zip.file('xl/styles.xml')!.async('string')).replace('</styleSheet>', '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>'));
    }));
    expect(report.nativeAllowed).toBe(true);
    const output = await unpack(await generateSafeDocument(doc, [edit], report));
    expect(await output.file('xl/styles.xml')!.async('string')).toContain('TableStyleMedium2');
  });

  it('cleans analogous workbook program names and theme labels without mutating the source', async () => {
    const { document: doc, report } = await parseSafeDocument(await excel(async (zip) => {
      zip.file('xl/workbook.xml', (await zip.file('xl/workbook.xml')!.async('string')).replace('<sheets>', '<fileVersion appName="陳隱名程式"/><workbookPr codeName="陳隱名代碼"/><sheets>'));
      zip.file('xl/theme/theme1.xml', '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="陳隱名主題"><a:themeElements><a:fontScheme name="陳隱名樣式"><a:majorFont><a:latin typeface="陳隱名字型"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>');
    }));
    expect(report.nativeAllowed).toBe(true);
    const output = await unpack(await generateSafeDocument(doc, [edit], report));
    expect((await output.file('xl/workbook.xml')!.async('string')) + (await output.file('xl/theme/theme1.xml')!.async('string'))).not.toContain('陳隱名');
    expect(await (doc.handle as { zip: JSZip }).zip.file('xl/workbook.xml')!.async('string')).toContain('陳隱名');
  });

  it.each([
    ['custom workbook views', 'xl/workbook.xml', '</workbook>', '<customWorkbookViews><customWorkbookView name="陳隱名檢視" guid="{62D90FE1-EB08-431A-8F77-DA102385F56D}" windowWidth="20000" windowHeight="10000" activeSheetId="0"/></customWorkbookViews></workbook>'],
    ['unknown workbook root attribute', 'xl/workbook.xml', '<workbook ', '<workbook private="陳隱名檢視" '],
    ['unknown worksheet attribute', 'xl/worksheets/sheet1.xml', '<sheetData>', '<sheetData private="陳隱名檢視">'],
    ['unknown worksheet structure', 'xl/worksheets/sheet1.xml', '</worksheet>', '<futureMetadata name="陳隱名檢視"/></worksheet>'],
    ['unknown shared-string structure', 'xl/sharedStrings.xml', '</sst>', '<futureMetadata name="陳隱名檢視"/></sst>'],
  ])('blocks unreviewed Excel %s under closed schemas', async (_, path, from, to) => {
    const { document: doc, report } = await parseSafeDocument(await excel(async (zip) => { zip.file(path, (await zip.file(path)!.async('string')).replace(from, to)); }));
    expect(doc.text).not.toContain('陳隱名');
    expect(report.nativeAllowed).toBe(false);
    expect(JSON.stringify(report)).not.toContain('陳隱名');
    await expect(generateSafeDocument(doc, [edit], { nativeAllowed: true, issues: [] })).rejects.toThrow(/原格式/);
  });

  it('blocks unknown theme metadata instead of trusting a theme part filename', async () => {
    const { report } = await parseSafeDocument(await excel((zip) => {
      zip.file('xl/theme/theme1.xml', '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="一般主題" private="陳隱名檢視"><a:themeElements/></a:theme>');
    }));
    expect(report.nativeAllowed).toBe(false);
  });

  it.each(['xl/workbook.xml', 'xl/styles.xml', '[Content_Types].xml'])('blocks arbitrary source text hidden in namespace declarations of %s', async (path) => {
    const { report } = await parseSafeDocument(await excel(async (zip) => {
      zip.file(path, (await zip.file(path)!.async('string')).replace('xmlns=', 'xmlns:private="urn:陳隱名檢視" xmlns='));
    }));
    expect(report.nativeAllowed).toBe(false);
  });

  it('keeps ordinary workbook views, worksheet layout and inline text eligible', async () => {
    const { document: doc, report } = await parseSafeDocument(await excel(async (zip) => {
      zip.file('xl/workbook.xml', (await zip.file('xl/workbook.xml')!.async('string')).replace('<sheets>', '<bookViews><workbookView activeTab="0" windowWidth="20000" windowHeight="10000"/></bookViews><sheets>'));
      zip.file('xl/worksheets/sheet1.xml', (await zip.file('xl/worksheets/sheet1.xml')!.async('string')).replace('<sheetData>', '<dimension ref="A1:B1"/><sheetViews><sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews><sheetData>').replace('</worksheet>', '<mergeCells count="1"><mergeCell ref="A2:B2"/></mergeCells><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>'));
    }));
    expect(report.nativeAllowed, JSON.stringify(report.issues)).toBe(true);
    const output = await unpack(await generateSafeDocument(doc, [edit], report));
    expect(await output.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('mergeCell');
  });

  it('preserves Excel source bytes across repeated different exports', async () => {
    const { document: doc, report } = await parseSafeDocument(await excel());
    const source = (doc.handle as { zip: JSZip }).zip;
    const before = await source.file('xl/sharedStrings.xml')!.async('string');
    const first = await unpack(await generateSafeDocument(doc, [edit], report));
    const second = await unpack(await generateSafeDocument(doc, [], report));
    expect(await source.file('xl/sharedStrings.xml')!.async('string')).toBe(before);
    expect(await second.file('xl/sharedStrings.xml')!.async('string')).toContain('王小明');
    expect(await first.file('xl/sharedStrings.xml')!.async('string')).not.toContain('王小明');
  });

  it('removes metadata relationships, property declarations, authors and ZIP comments', async () => {
    const { document: doc, report } = await parseSafeDocument(await word(async (zip) => {
      zip.file('docProps/core.xml', '<properties><creator>秘密作者</creator></properties>');
      zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml')!.async('string')).replace('</Types>', '<Override PartName="/docProps/core.xml" ContentType="application/xml"/></Types>'));
      zip.file('_rels/.rels', (await zip.file('_rels/.rels')!.async('string')).replace('</Relationships>', '<Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/core-properties" Target="docProps/core.xml"/></Relationships>'));
      zip.file('word/document.xml', (await zip.file('word/document.xml')!.async('string')).replace('<w:p>', '<w:p w:author="秘密作者">'), { comment: '秘密備註' });
    }));
    const output = await unpack(await generateSafeDocument(doc, [], report));
    expect(output.file('docProps/core.xml')).toBeNull();
    const values = (await Promise.all(Object.values(output.files).filter((f) => !f.dir).map((f) => f.async('string')))).join('');
    expect(values).not.toMatch(/秘密作者|docProps\/core.xml|core-properties/);
    expect(output.file('word/document.xml')!.comment).toBeFalsy();
  });

  it('blocks numeric phone cells with a clear omission warning', async () => {
    const { report } = await parseSafeDocument(await excel(undefined, true));
    expect(report.nativeAllowed).toBe(false);
    expect(report.issues.some((i) => /數值/.test(i.message))).toBe(true);
    expect(JSON.stringify(report)).not.toContain('912345678');
  });

  it.each([
    ['hidden sheet', 'xl/workbook.xml', 'sheet name=', 'sheet state="hidden" name='],
    ['hidden row', 'xl/worksheets/sheet1.xml', '<row r=', '<row hidden="1" r='],
    ['formula', 'xl/worksheets/sheet1.xml', '<v>0</v>', '<f>"秘密公式"</f><v>0</v>'],
    ['defined name', 'xl/workbook.xml', '</workbook>', '<definedNames><definedName name="秘密">Sheet1!A1</definedName></definedNames></workbook>'],
  ])('blocks Excel %s', async (_, path, from, to) => {
    const { report } = await parseSafeDocument(await excel(async (zip) => {
      zip.file(path, (await zip.file(path)!.async('string')).replace(from, to));
    }));
    expect(report.nativeAllowed).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/秘密|Sheet1/);
  });

  it('cleans source values used only in style labels rather than preserving them invisibly', async () => {
    const { document: doc, report } = await parseSafeDocument(await word(async (zip) => {
      zip.file('word/styles.xml', (await zip.file('word/styles.xml')!.async('string')).replace('Normal"/>', 'A123456789"/>'));
    }));
    expect(doc.text).not.toContain('A123456789');
    const output = await unpack(await generateSafeDocument(doc, [edit], report));
    expect(await output.file('word/styles.xml')!.async('string')).not.toContain('A123456789');
  });

  it.each([
    ['bookmark', '<w:bookmarkStart w:id="1" w:name="A123456789"/><w:bookmarkEnd w:id="1"/>'],
    ['unknown attribute', '<w:p w:private="A123456789"><w:r><w:t>一般文字</w:t></w:r></w:p>'],
    ['unknown element text', '<w:private>A123456789</w:private>'],
    ['unknown attribute on known element', '<w:p w:name="A123456789"/>'],
    ['known enum in an invalid text-field location', '<w:p w:name="roman"/>'],
  ])('blocks unextracted Word %s without disclosing its contents', async (_, payload) => {
    const { document: doc, report } = await parseSafeDocument(await word(async (zip) => {
      zip.file('word/document.xml', (await zip.file('word/document.xml')!.async('string')).replace('<w:sectPr/>', payload + '<w:sectPr/>'));
    }));
    expect(doc.text).not.toContain('A123456789');
    expect(report.nativeAllowed).toBe(false);
    expect(JSON.stringify(report)).not.toContain('A123456789');
    await expect(generateSafeDocument(doc, [edit], { nativeAllowed: true, issues: [] })).rejects.toThrow(/原格式/);
  });

  it('rejects changed Word source text before applying stale reviewed offsets', async () => {
    const { document: doc, report } = await parseSafeDocument(await word());
    const changed = await JSZip.loadAsync(await buildDocx({ paragraphs: [['李小華聯絡資料 A123456789']] }));
    (doc.handle as { zip: JSZip }).zip.file('word/document.xml', await changed.file('word/document.xml')!.async('string'));
    await expect(generateSafeDocument(doc, [edit], report)).rejects.toThrow(/變更|重新載入/);
  });

  it('rejects changed Excel source strings before applying stale reviewed offsets', async () => {
    const { document: doc, report } = await parseSafeDocument(await excel());
    const zip = (doc.handle as { zip: JSZip }).zip;
    zip.file('xl/sharedStrings.xml', (await zip.file('xl/sharedStrings.xml')!.async('string')).replace('王小明', '李小華 A123456789'));
    await expect(generateSafeDocument(doc, [edit], report)).rejects.toThrow(/變更|重新載入/);
  });

  it('cleans custom Word style IDs, linked styles and font labels consistently', async () => {
    const { document: doc, report } = await parseSafeDocument(await word(async (zip) => {
      zip.file('word/document.xml', (await zip.file('word/document.xml')!.async('string')).replace('w:val="Normal"', 'w:val="A123456789"').replace('<w:b/>', '<w:b/><w:rFonts w:ascii="B123456789" w:eastAsia="B123456789"/>'));
      zip.file('word/styles.xml', (await zip.file('word/styles.xml')!.async('string')).replace('w:styleId="Normal"', 'w:styleId="A123456789"'));
    }));
    expect(report.nativeAllowed).toBe(true);
    const output = await unpack(await generateSafeDocument(doc, [edit], report));
    const documentXml = await output.file('word/document.xml')!.async('string');
    const styles = await output.file('word/styles.xml')!.async('string');
    expect(documentXml + styles).not.toMatch(/A123456789|B123456789/);
    const id = new DOMParser().parseFromString(documentXml, 'application/xml').getElementsByTagNameNS(W, 'pStyle')[0].getAttributeNS(W, 'val');
    expect(styles).toContain(`w:styleId="${id}"`);
  });

  it('rejects coherent changes to both reviewed text and the source ZIP', async () => {
    const { document: doc, report } = await parseSafeDocument(await word());
    const source = (doc.handle as { zip: JSZip }).zip;
    source.file('word/document.xml', (await source.file('word/document.xml')!.async('string')).replace('王小明', '李小華'));
    doc.text = doc.text.replace('王小明', '李小華');
    await expect(generateSafeDocument(doc, [edit], report)).rejects.toThrow(/變更|重新載入/);
  });

  it.each(['_rels/.rels', '[Content_Types].xml'])('blocks unreviewed attributes inside package manifest %s', async (path) => {
    const { report } = await parseSafeDocument(await word(async (zip) => {
      zip.file(path, (await zip.file(path)!.async('string')).replace(path.endsWith('.rels') ? '<Relationships ' : '<Types ', path.endsWith('.rels') ? '<Relationships private="A123456789" ' : '<Types private="A123456789" '));
    }));
    expect(report.nativeAllowed).toBe(false);
  });

  it('rechecks modified handles instead of trusting earlier inspection', async () => {
    const { document: doc, report } = await parseSafeDocument(await word());
    (doc.handle as { zip: JSZip }).zip.file('word/comments.xml', '<comments/>');
    expect((await inspectDocument(doc)).nativeAllowed).toBe(false);
    await expect(generateSafeDocument(doc, [edit], report)).rejects.toThrow(/原格式/);
  });

  it('rejects remaining values split across pretty-printed runs and decoded XML entities', async () => {
    const { document: doc, report } = await parseSafeDocument(await word(async (zip) => {
      const value = await zip.file('word/document.xml')!.async('string');
      zip.file('word/document.xml', value.replace('<w:sectPr/>', '<w:p><w:r><w:t>&#x738B;</w:t></w:r>\n  <w:r><w:t>小明</w:t></w:r></w:p><w:sectPr/>'));
    }));
    await expect(generateSafeDocument(doc, [edit], report)).rejects.toThrow(/殘留/);
  });

  it('rejects a selected multiline original remaining in other document paragraphs', async () => {
    const bytes = await buildDocx({ paragraphs: [['第一行'], ['第二行'], ['第一行'], ['第二行']] });
    const { document: doc, report } = await parseSafeDocument(toFile(bytes, 'input.docx'));
    await expect(generateSafeDocument(doc, [{ start: 0, end: 7, replacement: '[文字1]' }], report)).rejects.toThrow(/殘留/);
  });

  it('rejects cell string indexes pointing to missing text instead of claiming full coverage', async () => {
    const { report } = await parseSafeDocument(await excel(async (zip) => {
      zip.file('xl/worksheets/sheet1.xml', (await zip.file('xl/worksheets/sheet1.xml')!.async('string')).replace('<v>0</v>', '<v>9999</v>'));
    }));
    expect(report.nativeAllowed).toBe(false);
  });

  it('blocks unsupported custom numbering text', async () => {
    const { report } = await parseSafeDocument(await word(async (zip) => {
      zip.file('word/numbering.xml', `<w:numbering xmlns:w="${W}"><w:abstractNum><w:lvl><w:lvlText w:val="隱藏姓名 %1"/></w:lvl></w:abstractNum></w:numbering>`);
    }));
    expect(report.nativeAllowed).toBe(false);
  });

  it('blocks numeric phone text stored as a fixed numbering label', async () => {
    const { report } = await parseSafeDocument(await word((zip) => {
      zip.file('word/numbering.xml', `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:lvlText w:val="0912345678"/></w:lvl></w:abstractNum></w:numbering>`);
    }));
    expect(report.nativeAllowed).toBe(false);
  });

  it('blocks XML comments instead of keeping unreviewed hidden text', async () => {
    const { report } = await parseSafeDocument(await word(async (zip) => {
      zip.file('word/styles.xml', (await zip.file('word/styles.xml')!.async('string')).replace('</w:styles>', '<!--隱藏秘密--></w:styles>'));
    }));
    expect(report.nativeAllowed).toBe(false);
  });

  it('blocks spreadsheet page headers that the upstream cell parser does not extract', async () => {
    const { report } = await parseSafeDocument(await excel(async (zip) => {
      zip.file('xl/worksheets/sheet1.xml', (await zip.file('xl/worksheets/sheet1.xml')!.async('string')).replace('</worksheet>', '<headerFooter><oddHeader>秘密頁首</oddHeader></headerFooter></worksheet>'));
    }));
    expect(report.nativeAllowed).toBe(false);
  });

  it('rejects oversized decompressed ZIP payload before XML parsing', async () => {
    await expect(parseSafeDocument(await word((zip) => { zip.file('word/settings.xml', ' '.repeat(9 * 1024 * 1024)); }))).rejects.toThrow(/解壓|結構/);
  });

  it('rejects excessive ZIP entry counts and total expanded data', async () => {
    const zip = new JSZip();
    for (let i = 0; i < 2049; i++) zip.file(`item${i}.xml`, '<x/>');
    await expect(parseSafeDocument(toFile(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), 'count.docx'))).rejects.toThrow(/解壓|結構/);
    const large = new JSZip();
    for (let i = 0; i < 5; i++) large.file(`item${i}.xml`, ' '.repeat(7 * 1024 * 1024));
    await expect(parseSafeDocument(toFile(await large.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), 'expanded.docx'))).rejects.toThrow(/解壓|結構/);
  });

  it('blocks orphan worksheet parts that are absent from the workbook preview', async () => {
    const { report } = await parseSafeDocument(await excel(async (zip) => {
      zip.file('xl/worksheets/sheet2.xml', await zip.file('xl/worksheets/sheet1.xml')!.async('string'));
    }));
    expect(report.nativeAllowed).toBe(false);
    expect(report.issues.some((i) => i.code === 'unreferenced-sheet')).toBe(true);
  });

  it('rejects unsupported document namespaces and source format/size', async () => {
    const { report } = await parseSafeDocument(await word(async (zip) => {
      zip.file('word/document.xml', (await zip.file('word/document.xml')!.async('string')).replace(W, 'urn:unknown'));
    }));
    expect(report.nativeAllowed).toBe(false);
    await expect(parseSafeDocument(new File(['content'], 'source.exe'))).rejects.toThrow(/不支援/);
    const huge = new File([], 'source.txt');
    Object.defineProperty(huge, 'size', { value: 101 * 1024 * 1024 });
    await expect(parseSafeDocument(huge)).rejects.toThrow(/100 MB/);
  });
});
