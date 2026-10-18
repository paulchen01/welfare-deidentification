import JSZip from 'jszip';
import type { LoadedDocument, TextEdit } from '../core/types';
import { generateDocument, parseDocument, validateFile } from '../formats';
import type { ParsePdfOptions, PdfHandle } from '../formats/pdf';

export interface SafetyIssue { code: string; severity: 'block' | 'review' | 'info'; message: string }
export interface FormatSafetyReport { nativeAllowed: boolean; issues: SafetyIssue[]; pages?: number }

// Limits apply before decompression, and again to actual streamed bytes. ZIP64 and
// encrypted archives are deliberately unsupported; a 100 MB input cap alone is insufficient.
const MAX_ENTRIES = 2048;
const MAX_PART = 8 * 1024 * 1024;
const MAX_EXPANDED = 32 * 1024 * 1024;
const ZIP_ERROR = '文件壓縮結構無效或解壓大小超過安全上限（單一項目 8 MB、合計 32 MB、2048 個項目）';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const X = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const META = /^docProps\/(core|app|custom)\.xml$/;
type OfficeHandle = { zip: JSZip };

function xml(value: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('文件含不支援的 XML 結構');
  const doc = new DOMParser().parseFromString(value, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('無法解析文件 XML 結構');
  return doc;
}
function elements(doc: Document, names: string[]): boolean {
  return Array.from(doc.getElementsByTagName('*')).some((el) => names.includes(el.localName));
}

/** Bound central-directory declarations before JSZip allocates or inflates anything. */
function checkCentralDirectory(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error(ZIP_ERROR);
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  const directoryEnd = at + size;
  if (!count || count > MAX_ENTRIES || count !== view.getUint16(end + 8, true) || directoryEnd > end) throw new Error(ZIP_ERROR);
  let total = 0;
  const paths = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > directoryEnd || view.getUint32(at, true) !== 0x02014b50) throw new Error(ZIP_ERROR);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const expanded = view.getUint32(at + 24, true);
    const nameSize = view.getUint16(at + 28, true);
    const next = at + 46 + nameSize + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (next > directoryEnd || expanded > MAX_PART || (total += expanded) > MAX_EXPANDED || flags & 1 || ![0, 8].includes(method)) throw new Error(ZIP_ERROR);
    const path = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameSize));
    if (paths.has(path) || /(^\/|\\|(^|\/)\.\.?($|\/)|\u0000)/.test(path)) throw new Error(ZIP_ERROR);
    paths.add(path);
    at = next;
  }
  if (at !== directoryEnd) throw new Error(ZIP_ERROR);
}

async function boundedParts(zip: JSZip): Promise<Map<string, Uint8Array>> {
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (Object.keys(zip.files).length > MAX_ENTRIES) throw new Error(ZIP_ERROR);
  const result = new Map<string, Uint8Array>();
  let total = 0;
  for (const entry of entries) {
    const chunks: Uint8Array[] = [];
    let length = 0;
    await new Promise<void>((resolve, reject) => {
      // JSZip 3 exposes this browser streaming API but omits it from JSZipObject's types.
      const stream = (entry as JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array');
      stream.on('data', (chunk: Uint8Array) => {
        length += chunk.length;
        total += chunk.length;
        if (length > MAX_PART || total > MAX_EXPANDED) { stream.pause(); reject(new Error(ZIP_ERROR)); return; }
        chunks.push(chunk);
      }).on('error', () => reject(new Error(ZIP_ERROR))).on('end', resolve).resume();
    });
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    result.set(entry.name, bytes);
  }
  return result;
}

const officeAllowed = (path: string, format: 'docx' | 'xlsx') =>
  path === '[Content_Types].xml' || path === '_rels/.rels' || META.test(path) ||
  (format === 'docx'
    ? /^word\/(document|header\d*|footer\d*|styles|settings|webSettings|fontTable|numbering)\.xml$/.test(path) || /^word\/theme\/theme\d+\.xml$/.test(path) || /^word\/_rels\/(document|header\d*|footer\d*|styles|settings|webSettings|fontTable|numbering)\.xml\.rels$/.test(path)
    : /^xl\/(workbook|sharedStrings|styles)\.xml$/.test(path) || /^xl\/worksheets\/sheet\d+\.xml$/.test(path) || /^xl\/theme\/theme\d+\.xml$/.test(path) || path === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(path));

async function inspectOffice(doc: LoadedDocument): Promise<FormatSafetyReport> {
  const issues: SafetyIssue[] = [];
  const add = (code: string, message: string, severity: SafetyIssue['severity'] = 'block') => {
    if (!issues.some((issue) => issue.code === code)) issues.push({ code, severity, message });
  };
  const zip = (doc.handle as OfficeHandle)?.zip;
  if (!zip || typeof zip.file !== 'function') throw new Error('文件來源結構無效');
  const parts = await boundedParts(zip);
  const shared = doc.format === 'xlsx' && parts.has('xl/sharedStrings.xml') ? xml(new TextDecoder().decode(parts.get('xl/sharedStrings.xml'))).getElementsByTagNameNS(X, 'si').length : 0;
  if (doc.format === 'xlsx') {
    const parsedSheets = new Set((doc.handle as OfficeHandle & { sheets: { path: string }[] }).sheets.map((sheet) => sheet.path));
    if ([...parts.keys()].some((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path) && !parsedSheets.has(path))) add('unreferenced-sheet', 'Excel 含未納入預覽的工作表項目，無法完整涵蓋');
  }
  for (const [path, bytes] of parts) {
    if (!officeAllowed(path, doc.format as 'docx' | 'xlsx')) {
      const [code, message] = /comment/i.test(path) ? ['comments', '文件含註解，註解內容未納入預覽，請改用已核對的純文字輸出']
        : /footnotes|endnotes/i.test(path) ? ['notes', '文件含註腳或章節附註，內容未完整納入預覽']
          : /media|drawing|embedding|vbaProject|activeX/i.test(path) ? ['media-embedded', '文件含圖片、繪圖或內嵌物件，可能有未擷取資訊，已阻擋原格式輸出']
            : /customXml/i.test(path) ? ['custom-xml', '文件含自訂 XML 資料，無法完整涵蓋']
              : /signature/i.test(path) ? ['signature', '文件含數位簽章，無法安全保留原格式']
                : ['unsupported-part', '文件含不支援的封裝項目，內容未完整納入檢查'];
      add(code, message);
      continue;
    }
    const part = xml(new TextDecoder().decode(bytes));
    if (META.test(path)) { add('metadata-cleaned', '輸出將移除文件屬性與作者等中繼資料', 'info'); continue; }
    const hiddenNodes = part.createTreeWalker(part, NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_PROCESSING_INSTRUCTION);
    if (hiddenNodes.nextNode()) add('hidden-xml', '文件 XML 含註解或處理指令，隱藏內容未納入預覽');
    if (path.endsWith('.rels')) {
      for (const rel of Array.from(part.getElementsByTagName('*')).filter((el) => el.localName === 'Relationship')) {
        const type = rel.getAttribute('Type')?.split('/').pop() ?? '';
        if (rel.getAttribute('TargetMode')?.toLowerCase() === 'external' || type === 'hyperlink' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(rel.getAttribute('Target') ?? '')) add('external-link', '文件含外部或超連結關聯，連結資訊未納入文字處理');
        else if (!['officeDocument', 'styles', 'settings', 'webSettings', 'fontTable', 'numbering', 'header', 'footer', 'theme', 'worksheet', 'sharedStrings', 'core-properties', 'extended-properties', 'custom-properties'].includes(type)) add('unsupported-relation', '文件含不支援的關聯項目，無法完整涵蓋');
      }
    }
    if (doc.format === 'docx') {
      if (/^word\/(document|header\d*|footer\d*)\.xml$/.test(path) && part.documentElement.namespaceURI !== W) add('unsupported-schema', '文件正文使用不支援的 XML 格式，無法完整擷取');
      if (elements(part, ['del', 'delText', 'delInstrText', 'ins', 'moveFrom', 'moveTo', 'moveFromRangeStart', 'moveToRangeStart', 'pPrChange', 'rPrChange', 'tblPrChange', 'sectPrChange', 'cellIns', 'cellDel', 'cellMerge', 'tblPrExChange', 'tcPrChange', 'trPrChange', 'tblGridChange', 'numberingChange'])) add('revisions', 'Word 含修訂、刪除或移動記錄，舊內容未納入預覽');
      if (elements(part, ['commentRangeStart', 'commentReference', 'footnoteReference', 'endnoteReference'])) add('notes', 'Word 含註解或附註參照，內容未完整納入預覽');
      if (elements(part, ['txbxContent', 'textbox', 'Fallback', 'AlternateContent', 'instrText', 'fldSimple', 'fldChar', 'altChunk', 'sdt', 'drawing', 'pict', 'object', 'subDoc', 'docVars', 'dataBinding', 'mailMerge', 'hyperlink'])) add('unsupported-word-text', 'Word 含文字方塊、欄位指令、繪圖、超連結或特殊文字結構，無法確認完整涵蓋');
      if (elements(part, ['vanish', 'webHidden', 'specVanish'])) add('hidden-word-text', 'Word 含隱藏文字或隱藏樣式，請核對擷取文字');
      if (Array.from(part.getElementsByTagNameNS(W, 'lvlText')).some((el) => /[^\d%\s.、()（）\-．]/u.test(el.getAttributeNS(W, 'val') ?? ''))) add('uncovered-numbering', 'Word 編號含自訂文字，未納入文字偵測');
      if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(path) && part.getElementsByTagNameNS(W, 't').length) add('uncovered-word-text', 'Word 的非正文項目含文字，未完整納入預覽');
    } else {
      if (/^xl\/(workbook|sharedStrings|styles|worksheets\/sheet\d+)\.xml$/.test(path) && part.documentElement.namespaceURI !== X) add('unsupported-schema', '試算表使用不支援的 XML 格式，無法完整擷取');
      if (elements(part, ['f', 'definedName', 'externalReference', 'calcChain', 'pivotTable', 'tablePart'])) add('formula-reference', 'Excel 含公式、名稱或資料參照；公式及快取值未完整納入偵測，已阻擋原格式輸出');
      if (elements(part, ['rPh', 'phoneticPr', 'extLst', 'legacyDrawing', 'drawing', 'hyperlink', 'oleObject', 'headerFooter', 'dataValidations', 'conditionalFormatting', 'customSheetViews', 'controls', 'webPublishItems', 'scenarios'])) add('unsupported-excel-text', 'Excel 含頁首頁尾、驗證規則、注音、擴充、超連結或繪圖內容，未完整納入預覽');
      if (elements(part, ['numFmt'])) add('custom-number-format', 'Excel 含自訂數字格式，顯示文字未完整納入偵測');
      for (const el of Array.from(part.getElementsByTagName('*'))) {
        if (['sheet', 'row', 'col'].includes(el.localName) && (['hidden', 'veryHidden'].includes(el.getAttribute('state') ?? '') || ['1', 'true'].includes(el.getAttribute('hidden') ?? ''))) add('hidden-excel', 'Excel 含隱藏工作表、列或欄；部分擷取文字可能來自隱藏範圍，請核對');
        if (el.namespaceURI === X && el.localName === 'c') {
          const type = el.getAttribute('t');
          if (type === 's') {
            const value = el.getElementsByTagNameNS(X, 'v')[0]?.textContent ?? '';
            if (!/^\d+$/.test(value) || Number(value) >= shared) add('unresolved-string', 'Excel 有無法解析的共用字串索引，預覽文字不完整');
          }
          if (!['s', 'inlineStr'].includes(type ?? '') && (el.getElementsByTagNameNS(X, 'v').length || el.getElementsByTagNameNS(X, 'f').length)) add('numeric-cells', 'Excel 含數值、布林或公式儲存格；數值電話、證號及公式結果未納入文字偵測，已阻擋原格式輸出');
        }
      }
    }
  }
  if (doc.format === 'xlsx') add('sheet-names-cleaned', '安全原格式輸出會將工作表名稱改為中性工作表加序號', 'info');
  return { nativeAllowed: !issues.some((issue) => issue.severity === 'block'), issues };
}

export async function inspectDocument(doc: LoadedDocument): Promise<FormatSafetyReport> {
  if (doc.format === 'docx' || doc.format === 'xlsx') return inspectOffice(doc);
  if (doc.format === 'pdf') {
    const pages = (doc.handle as PdfHandle)?.pages;
    if (!Array.isArray(pages) || !pages.length) throw new Error('PDF 頁面結構無效');
    const incomplete = pages.some((page) => !page.items.some((item) => item.text.trim()));
    const issues: SafetyIssue[] = [{ code: 'pdf-reconstructed', severity: 'review', message: 'PDF 只重建已擷取或辨識的文字；圖片一律排除，未擷取的視覺文字可能遺漏，請逐頁核對' }];
    if (doc.ocr) issues.push({ code: 'ocr-review', severity: 'review', message: '部分或全部頁面經 OCR 辨識，可能有誤認與遺漏，請逐頁核對' });
    if (incomplete) issues.push({ code: 'incomplete-pages', severity: 'block', message: '至少一頁沒有可讀文字，文件擷取不完整，已阻擋原格式輸出' });
    return { nativeAllowed: !incomplete, issues, pages: pages.length };
  }
  return { nativeAllowed: true, issues: [] };
}

export async function parseSafeDocument(file: File, options: ParsePdfOptions = {}): Promise<{ document: LoadedDocument; report: FormatSafetyReport }> {
  const format = validateFile(file);
  if (format === 'docx' || format === 'xlsx') {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      checkCentralDirectory(bytes);
      await boundedParts(await JSZip.loadAsync(bytes));
    } catch { throw new Error(ZIP_ERROR); }
  }
  let document: LoadedDocument;
  try {
    document = await parseDocument(file, format === 'pdf' ? { ...options, perPageOcr: true, ocr: options.ocr ?? {} } : options);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('無法完整讀取文件；請確認格式與結構，或改用可讀的文字檔');
  }
  if (document.format === 'pdf') for (const page of (document.handle as PdfHandle).pages) for (const picture of page.pictures ?? []) picture.keep = false;
  return { document, report: await inspectDocument(document) };
}

function checkedOriginals(doc: LoadedDocument, edits: TextEdit[]): string[] {
  const ordered = [...edits].sort((a, b) => a.start - b.start);
  let end = 0;
  for (const edit of ordered) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < end || edit.start < 0 || edit.end <= edit.start || edit.end > doc.text.length || typeof edit.replacement !== 'string') throw new Error('文字替換範圍無效');
    end = edit.end;
  }
  return [...new Set(ordered.map((edit) => doc.text.slice(edit.start, edit.end)))];
}
function rejectRemnants(texts: string[], originals: string[]): void {
  if (originals.some((value) => texts.some((text) => text.includes(value)))) throw new Error('安全檢查發現選取的原值仍有殘留，已阻擋輸出');
}

async function sanitizeOffice(zip: JSZip, format: 'docx' | 'xlsx'): Promise<void> {
  (zip as JSZip & { comment: string }).comment = '';
  for (const entry of Object.values(zip.files)) {
    entry.comment = '';
    if (entry.dir) continue;
    if (META.test(entry.name)) { zip.remove(entry.name); continue; }
    const part = xml(await entry.async('string'));
    for (const el of Array.from(part.getElementsByTagName('*'))) {
      // These attributes describe edit history/authorship rather than document content.
      for (const attr of Array.from(el.attributes)) if (['author', 'initials', 'lastModifiedBy', 'userName'].includes(attr.localName) || /^rsid/i.test(attr.localName)) el.removeAttributeNode(attr);
      if (entry.name === '[Content_Types].xml' && el.localName === 'Override' && META.test((el.getAttribute('PartName') ?? '').replace(/^\//, ''))) el.remove();
      if (entry.name.endsWith('.rels') && el.localName === 'Relationship' && /\/(core-properties|extended-properties|custom-properties)$/.test(el.getAttribute('Type') ?? '')) el.remove();
    }
    if (format === 'xlsx' && entry.name === 'xl/workbook.xml') Array.from(part.getElementsByTagNameNS(X, 'sheet')).forEach((sheet, i) => sheet.setAttribute('name', `中性工作表${i + 1}`));
    zip.file(entry.name, new XMLSerializer().serializeToString(part));
  }
}

export async function generateSafeDocument(doc: LoadedDocument, edits: TextEdit[], _report: FormatSafetyReport): Promise<Blob> {
  const report = await inspectDocument(doc);
  if (!report.nativeAllowed) throw new Error('原格式輸出未通過結構涵蓋檢查，請核對後改用擷取文字輸出');
  const originals = checkedOriginals(doc, edits);
  if (doc.format === 'docx' || doc.format === 'xlsx') {
    // Upstream generators write into handle.zip. Reparse a fresh bounded snapshot
    // instead, so neither the source handle nor any previous output is mutated.
    const source = (doc.handle as OfficeHandle).zip;
    const freshZip = new JSZip();
    for (const [path, bytes] of await boundedParts(source)) freshZip.file(path, bytes);
    const bytes = await freshZip.generateAsync({ type: 'uint8array' });
    const fresh = await parseDocument(new File([bytes as BlobPart], `document.${doc.format}`));
    const result = await generateDocument(fresh, edits);
    const output = await JSZip.loadAsync(await result.arrayBuffer());
    await sanitizeOffice(output, doc.format);
    const texts: string[] = [];
    for (const [path, bytes] of await boundedParts(output)) {
      const value = new TextDecoder().decode(bytes);
      const part = xml(value);
      // textContent joins split runs; attributes cover names, labels and URLs.
      texts.push(value, part.documentElement.textContent ?? '', ...Array.from(part.getElementsByTagName('*')).flatMap((el) => Array.from(el.attributes).map((attr) => attr.value)));
      // Formatting whitespace between <r>/<t> elements is not visible text.
      // Concatenate just text runs within their semantic paragraph/string units.
      for (const el of Array.from(part.getElementsByTagName('*'))) {
        if ((el.namespaceURI === W && el.localName === 'p') || (el.namespaceURI === X && ['si', 'is'].includes(el.localName))) texts.push(Array.from(el.getElementsByTagNameNS(el.namespaceURI, 't')).map((run) => run.textContent ?? '').join(''));
      }
      if (!officeAllowed(path, doc.format)) throw new Error('輸出結構安全檢查失敗');
    }
    const blob = await output.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: result.type });
    // Regeneration of semantic text also covers selections containing paragraph,
    // table-cell or worksheet separators, which do not exist as literal XML text.
    texts.push((await parseDocument(new File([blob], `document.${doc.format}`))).text);
    rejectRemnants(texts, originals);
    return blob;
  }
  if (doc.format === 'pdf') {
    const handle = doc.handle as PdfHandle;
    const safeDoc = { ...doc, handle: { ...handle, pages: handle.pages.map((page) => ({ ...page, pictures: [] })) } };
    const output = await generateDocument(safeDoc, edits);
    const parsed = await parseDocument(new File([output], 'document.pdf'));
    rejectRemnants([parsed.text], originals);
    return output;
  }
  const output = await generateDocument(doc, edits);
  rejectRemnants([await output.text()], originals);
  return output;
}
