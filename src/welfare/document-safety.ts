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
const reviewedText = new WeakMap<LoadedDocument, string>();
const SOURCE_CHANGED = '文件來源或已覆核文字已變更，請重新載入並重新核對後輸出';
const STYLE_REFS = new Set(['pStyle', 'rStyle', 'tblStyle', 'basedOn', 'next', 'link', 'defaultTableStyle', 'numStyleLink', 'styleLink']);
const SAFE_NUMBERING_TEXT = /^(?:%[1-9]|[\s.、()（）\-．])*$/u;
const WORD_NODES = new Set(('document body hdr ftr p r t tab br cr tbl tr tc pPr rPr tblPr trPr tcPr sectPr tblGrid gridCol pStyle rStyle tblStyle b bCs i iCs u strike dstrike caps smallCaps outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing sz szCs highlight vertAlign rtl cs lang rFonts kern position fitText shd bdr pBdr top left bottom right between bar ind jc tabs tab contextualSpacing keepNext keepLines pageBreakBefore widowControl numPr ilvl numId suppressLineNumbers suppressAutoHyphens bidi textDirection textAlignment outlineLvl divId cnfStyle tblW tblInd tblBorders tblCellMar tblLayout tblLook tblCaption tblDescription tcW gridSpan vMerge vAlign tcBorders noWrap tcFitText hideMark cantSplit tblHeader trHeight gridBefore gridAfter wBefore wAfter pgSz pgMar pgNumType cols col docGrid headerReference footerReference titlePg type footnotePr endnotePr pgBorders vAlign printerSettings styles style name aliases basedOn next link autoRedefine hidden uiPriority semiHidden unhideWhenUsed qFormat locked personal personalCompose personalReply rsid docDefaults rPrDefault pPrDefault latentStyles lsdException settings zoom proofState defaultTabStop characterSpacingControl compat compatSetting rsids rsidRoot themeFontLang clrSchemeMapping doNotTrackMoves doNotTrackFormatting trackRevisions updateFields displayBackgroundShape evenAndOddHeaders mirrorMargins gutterAtTop drawingGridHorizontalSpacing drawingGridVerticalSpacing decimalSymbol listSeparator doNotAutoHyphenateConsecutiveUppercase hyphenationZone defaultTableStyle attachedTemplate webSettings optimizeForBrowser allowPNG fonts font altName charset family pitch panose1 sig notTrueType embedRegular embedBold embedItalic embedBoldItalic numbering abstractNum multiLevelType nsid tmpl numStyleLink styleLink lvl start numFmt lvlRestart lvlText lvlJc suff num lvlOverride startOverride').split(' '));
const WORD_ATTRIBUTES = new Set(('val type w h top right bottom left header footer gutter orient line lineRule before after beforeLines afterLines firstLine hanging firstLineChars hangingChars start end startChars endChars space size sz color fill themeColor themeTint themeShade asciiTheme hAnsiTheme eastAsiaTheme cstheme hint eastAsia cs ascii hAnsi anchor align pos leader ilvl numId abstractNumId ilvl restart startOverride numFmt chapStyle chapSep id customStyle default styleId qFormat uiPriority semiHidden unhideWhenUsed locked personal personalCompose personalReply count min max defLockedState defUIPriority defSemiHidden defUnhideWhenUsed defQFormat exceptions name font script charType charSpace linePitch num pos hRule gridSpan merge typeface pitchFamily charset sig usb0 usb1 usb2 usb3 csb0 csb1 uri namePercent percent zoom lang script').split(' '));
const SAFE_TOKENS = new Set(('true false on off none auto default normal paragraph character table numbering left right center both justify start end top bottom middle single double thick dotted dashed dotDash dotDotDash wave dashSmallGap thinThickSmallGap thickThinSmallGap thickThinMedGap thickThinLargeGap nil clear decimal decimalZero upperRoman lowerRoman upperLetter lowerLetter bullet ordinal cardinalText ordinalText hex chicago ideographDigital japaneseCounting aiueo iroha decimalFullWidth decimalHalfWidth decimalEnclosedCircle chineseCounting chineseLegalSimplified chineseCountingThousand taiwaneseCounting taiwaneseCountingThousand numInDash decimalEnclosedCircleChinese decimalEnclosedFullstop decimalEnclosedParen decimalNumber limit thaiNumbers hindiNumbers hAnsi eastAsia bidi minorHAnsi majorHAnsi minorEastAsia majorEastAsia minorBidi majorBidi majorAscii minorAscii dxa pct exact atLeast atMost multiple singleLine fixed autofit baseline superscript subscript landscape portrait continuous nextPage evenPage oddPage text column page line lrTb tbRl btLr lrTbV tbRlV tbLrV tab space nothing multilevel singleLevel hybridMultilevel modern roman swiss script decorative unknown variable fixedPitch black white red blue green yellow magenta cyan darkBlue darkCyan darkGreen darkMagenta darkRed darkYellow darkGray lightGray windowText window background1 text1 background2 text2 accent1 accent2 accent3 accent4 accent5 accent6 hyperlink followedHyperlink phClr lt1 dk1 lt2 dk2').split(' '));
function authorAttribute(attr: Attr): boolean { return ['author', 'initials', 'lastModifiedBy', 'userName', 'paraId', 'textId', 'docId'].includes(attr.localName) || /^rsid/i.test(attr.localName); }
function neutralWordAttribute(el: Element, attr: Attr): boolean {
  return el.namespaceURI === W && ((el.localName === 'style' && attr.localName === 'styleId') || (STYLE_REFS.has(el.localName) && attr.localName === 'val') || (['name', 'aliases', 'altName'].includes(el.localName) && attr.localName === 'val') || (['font', 'lsdException'].includes(el.localName) && attr.localName === 'name') || (el.localName === 'rFonts' && ['ascii', 'hAnsi', 'eastAsia', 'cs'].includes(attr.localName))) || /\/drawingml\/2006\/main$/.test(el.namespaceURI ?? '') && ['name', 'typeface'].includes(attr.localName);
}
/** Text-like metadata is neutralized; remaining Word XML needs known nodes and
 * typed formatting attributes. Unknown attributes are never covered by a part allowlist. */
function hasUnreviewedWordData(part: Document, path: string): boolean {
  if (!path.startsWith('word/')) return false;
  for (const el of Array.from(part.getElementsByTagName('*'))) {
    if (el.namespaceURI === W && !WORD_NODES.has(el.localName)) return true;
    if (Array.from(el.childNodes).some((node) => (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) && !!node.textContent?.trim() && !(el.namespaceURI === W && el.localName === 't'))) return true;
    for (const attr of Array.from(el.attributes)) {
      if (attr.namespaceURI === 'http://www.w3.org/2000/xmlns/' || authorAttribute(attr) || neutralWordAttribute(el, attr)) continue;
      if (attr.namespaceURI === 'http://www.w3.org/XML/1998/namespace' && attr.localName === 'space' && ['preserve', 'default'].includes(attr.value)) continue;
      if (attr.namespaceURI === 'http://schemas.openxmlformats.org/markup-compatibility/2006' && attr.localName === 'Ignorable') continue;
      if (path.endsWith('.rels')) continue; // Relationship values are checked separately.
      if (attr.namespaceURI === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' && attr.localName === 'id' && /^rId\d{1,6}$/.test(attr.value)) continue;
      if (attr.localName === 'name') {
        if (el.localName !== 'compatSetting' || !['compatibilityMode', 'overrideTableStyleFontSizeAndJustification', 'enableOpenTypeFeatures', 'doNotFlipMirrorIndents', 'differentiateMultirowTableHeaders'].includes(attr.value)) return true;
        continue;
      }
      if (attr.localName === 'styleId') return true; // Only style/@styleId is neutralized above.
      if (attr.localName === 'uri') { if (el.localName !== 'compatSetting' || attr.value !== 'http://schemas.microsoft.com/office/word') return true; continue; }
      if (!WORD_ATTRIBUTES.has(attr.localName)) return true;
      if (el.localName === 'lvlText' && attr.localName === 'val') { if (!SAFE_NUMBERING_TEXT.test(attr.value)) return true; continue; }
      if (['lang', 'themeFontLang'].includes(el.localName) && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(attr.value)) continue;
      if (['color', 'shd'].includes(el.localName) && /^[a-f\d]{6}$/i.test(attr.value)) continue;
      if ((el.localName === 'panose1' && /^[a-f\d]{20}$/i.test(attr.value)) || (['nsid', 'tmpl'].includes(el.localName) && /^[a-f\d]{8}$/i.test(attr.value))) continue;
      if (['decimalSymbol', 'listSeparator'].includes(el.localName) && /^[.,;]$/.test(attr.value)) continue;
      if (/^-?\d{1,6}(?:\.\d{1,3})?$/.test(attr.value) || SAFE_TOKENS.has(attr.value)) continue;
      if (attr.localName === 'script' && /^[A-Z][a-z]{3}$/.test(attr.value)) continue;
      return true;
    }
  }
  return false;
}
function hasUnreviewedPackageData(part: Document, path: string, parts: Map<string, Uint8Array>): boolean {
  if (path !== '[Content_Types].xml' && !path.endsWith('.rels')) return false;
  const relationship = path.endsWith('.rels');
  const allowedNames = relationship ? ['Relationships', 'Relationship'] : ['Types', 'Default', 'Override'];
  const types = new Set(['application/xml', 'application/vnd.openxmlformats-package.relationships+xml', 'application/vnd.openxmlformats-officedocument.theme+xml', ...['document.main', 'styles', 'settings', 'webSettings', 'fontTable', 'numbering', 'header', 'footer'].map((name) => `application/vnd.openxmlformats-officedocument.wordprocessingml.${name}+xml`), ...['sheet.main', 'worksheet', 'sharedStrings', 'styles'].map((name) => `application/vnd.openxmlformats-officedocument.spreadsheetml.${name}+xml`)]);
  for (const el of Array.from(part.getElementsByTagName('*'))) {
    if (!allowedNames.includes(el.localName) || el.textContent?.trim()) return true;
    const metadata = relationship ? /\/(core-properties|extended-properties|custom-properties)$/.test(el.getAttribute('Type') ?? '') : META.test((el.getAttribute('PartName') ?? '').replace(/^\//, ''));
    if (metadata) continue; // The complete metadata relation/declaration is removed.
    const attrs = el.localName === 'Relationship' ? ['Id', 'Type', 'Target', 'TargetMode'] : el.localName === 'Default' ? ['Extension', 'ContentType'] : el.localName === 'Override' ? ['PartName', 'ContentType'] : [];
    if (Array.from(el.attributes).some((attr) => attr.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && !attrs.includes(attr.name))) return true;
    if (el.localName === 'Relationship') {
      if (!/^rId\d{1,6}$/.test(el.getAttribute('Id') ?? '') || !/^http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/[a-zA-Z]+$/.test(el.getAttribute('Type') ?? '')) return true;
      const target = el.getAttribute('Target') ?? '';
      const base = path === '_rels/.rels' ? [] : path.split('/_rels/')[0].split('/');
      const resolved = target.startsWith('/') ? [] : [...base];
      for (const component of target.split('/')) {
        if (!component || component === '.') continue;
        if (component === '..') resolved.pop(); else resolved.push(component);
      }
      if (!parts.has(resolved.join('/'))) return true;
    } else if (el.localName === 'Default' || el.localName === 'Override') {
      if (!types.has(el.getAttribute('ContentType') ?? '')) return true;
      if (el.localName === 'Default' && !['xml', 'rels'].includes(el.getAttribute('Extension') ?? '')) return true;
      if (el.localName === 'Override' && !parts.has((el.getAttribute('PartName') ?? '').replace(/^\//, ''))) return true;
    }
  }
  return false;
}
const XLSX_STYLE_NODES = new Set(('styleSheet fonts font name charset family b i strike outline shadow condense extend color sz u vertAlign scheme fills fill patternFill fgColor bgColor gradientFill stop borders border left right top bottom diagonal vertical horizontal start end cellStyleXfs cellXfs xf alignment protection cellStyles cellStyle dxfs dxf tableStyles colors indexedColors rgbColor mruColors').split(' '));
const XLSX_STYLE_ATTRIBUTES: Record<string, string[]> = {
  fonts: ['count'], fills: ['count'], borders: ['count'], cellStyleXfs: ['count'], cellXfs: ['count'], cellStyles: ['count'], dxfs: ['count'],
  name: ['val'], charset: ['val'], family: ['val'], b: ['val'], i: ['val'], strike: ['val'], outline: ['val'], shadow: ['val'], condense: ['val'], extend: ['val'], sz: ['val'], u: ['val'], vertAlign: ['val'], scheme: ['val'],
  color: ['auto', 'indexed', 'rgb', 'theme', 'tint'], fgColor: ['auto', 'indexed', 'rgb', 'theme', 'tint'], bgColor: ['auto', 'indexed', 'rgb', 'theme', 'tint'], rgbColor: ['rgb'],
  patternFill: ['patternType'], gradientFill: ['type', 'degree', 'left', 'right', 'top', 'bottom'], stop: ['position'], border: ['diagonalUp', 'diagonalDown', 'outline'],
  left: ['style'], right: ['style'], top: ['style'], bottom: ['style'], diagonal: ['style'], vertical: ['style'], horizontal: ['style'], start: ['style'], end: ['style'],
  xf: ['numFmtId', 'fontId', 'fillId', 'borderId', 'xfId', 'applyNumberFormat', 'applyFont', 'applyFill', 'applyBorder', 'applyAlignment', 'applyProtection', 'pivotButton', 'quotePrefix'],
  alignment: ['horizontal', 'vertical', 'textRotation', 'wrapText', 'shrinkToFit', 'justifyLastLine', 'indent', 'relativeIndent', 'readingOrder'], protection: ['locked', 'hidden'],
  cellStyle: ['name', 'xfId', 'builtinId', 'iLevel', 'customBuiltin', 'hidden'], tableStyles: ['count', 'defaultTableStyle', 'defaultPivotStyle'],
};
const XLSX_STYLE_TOKENS = new Set(('true false none solid mediumGray darkGray lightGray darkHorizontal darkVertical darkDown darkUp darkGrid darkTrellis lightHorizontal lightVertical lightDown lightUp lightGrid lightTrellis gray125 gray0625 linear path thin medium dashed dotted thick double hair mediumDashed dashDot mediumDashDot dashDotDot mediumDashDotDot slantDashDot general left center right fill justify centerContinuous distributed top bottom baseline superscript subscript single singleAccounting doubleAccounting major minor').split(' '));
function neutralXlsxAttribute(el: Element, attr: Attr): boolean {
  return el.namespaceURI === X && ((el.localName === 'cellStyle' && attr.localName === 'name') || (el.localName === 'name' && el.parentElement?.localName === 'font' && attr.localName === 'val')) || /\/drawingml\/2006\/main$/.test(el.namespaceURI ?? '') && ['name', 'typeface'].includes(attr.localName);
}
function hasUnreviewedXlsxStyles(part: Document, path: string): boolean {
  if (path !== 'xl/styles.xml') return false;
  for (const el of Array.from(part.getElementsByTagName('*'))) {
    if (el.namespaceURI !== X || !XLSX_STYLE_NODES.has(el.localName) || el.textContent?.trim()) return true;
    for (const attr of Array.from(el.attributes)) {
      if (attr.namespaceURI === 'http://www.w3.org/2000/xmlns/' || neutralXlsxAttribute(el, attr)) continue;
      if (!XLSX_STYLE_ATTRIBUTES[el.localName]?.includes(attr.localName)) return true;
      if (['defaultTableStyle', 'defaultPivotStyle'].includes(attr.localName)) {
        if (!/^(?:Table|Pivot)Style(?:Light|Medium|Dark)[1-9]\d?$/.test(attr.value)) return true;
        continue;
      }
      if (attr.localName === 'rgb') { if (!/^[a-f\d]{8}$/i.test(attr.value)) return true; continue; }
      if (!/^-?\d{1,6}(?:\.\d{1,8})?$/.test(attr.value) && !XLSX_STYLE_TOKENS.has(attr.value)) return true;
    }
  }
  return false;
}

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
    if (hasUnreviewedPackageData(part, path, parts)) add('unreviewed-package-fields', '文件封裝清單含未知屬性、類型或未完整涵蓋的關聯，已阻擋原格式輸出');
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
      if (hasUnreviewedWordData(part, path)) add('unreviewed-word-fields', 'Word 含未納入預覽的書籤、文字屬性或不支援的 XML 欄位，已阻擋原格式輸出');
      add('word-labels-cleaned', '安全輸出會中性化樣式名稱、樣式識別碼、主題標籤與字型名稱，版面可能改變', 'info');
      if (/^word\/(document|header\d*|footer\d*)\.xml$/.test(path) && part.documentElement.namespaceURI !== W) add('unsupported-schema', '文件正文使用不支援的 XML 格式，無法完整擷取');
      if (elements(part, ['del', 'delText', 'delInstrText', 'ins', 'moveFrom', 'moveTo', 'moveFromRangeStart', 'moveToRangeStart', 'pPrChange', 'rPrChange', 'tblPrChange', 'sectPrChange', 'cellIns', 'cellDel', 'cellMerge', 'tblPrExChange', 'tcPrChange', 'trPrChange', 'tblGridChange', 'numberingChange'])) add('revisions', 'Word 含修訂、刪除或移動記錄，舊內容未納入預覽');
      if (elements(part, ['commentRangeStart', 'commentReference', 'footnoteReference', 'endnoteReference'])) add('notes', 'Word 含註解或附註參照，內容未完整納入預覽');
      if (elements(part, ['txbxContent', 'textbox', 'Fallback', 'AlternateContent', 'instrText', 'fldSimple', 'fldChar', 'altChunk', 'sdt', 'drawing', 'pict', 'object', 'subDoc', 'docVars', 'dataBinding', 'mailMerge', 'hyperlink', 'tblCaption', 'tblDescription'])) add('unsupported-word-text', 'Word 含文字方塊、欄位指令、繪圖、超連結或特殊文字結構，無法確認完整涵蓋');
      if (elements(part, ['vanish', 'webHidden', 'specVanish'])) add('hidden-word-text', 'Word 含隱藏文字或隱藏樣式，請核對擷取文字');
      if (Array.from(part.getElementsByTagNameNS(W, 'lvlText')).some((el) => !SAFE_NUMBERING_TEXT.test(el.getAttributeNS(W, 'val') ?? ''))) add('uncovered-numbering', 'Word 編號含自訂文字，未納入文字偵測');
      if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(path) && part.getElementsByTagNameNS(W, 't').length) add('uncovered-word-text', 'Word 的非正文項目含文字，未完整納入預覽');
    } else {
      if (hasUnreviewedXlsxStyles(part, path)) add('unreviewed-excel-styles', 'Excel 樣式含自訂表格樣式或未知文字屬性，未納入預覽，已阻擋原格式輸出');
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
  if (doc.format === 'xlsx') {
    add('sheet-names-cleaned', '安全原格式輸出會將工作表名稱改為中性工作表加序號', 'info');
    add('excel-style-labels-cleaned', '安全輸出會中性化儲存格樣式、字型、主題及程式識別名稱，字型與版面可能改變', 'info');
  }
  return { nativeAllowed: !issues.some((issue) => issue.severity === 'block'), issues };
}

export async function inspectDocument(doc: LoadedDocument): Promise<FormatSafetyReport> {
  if (!reviewedText.has(doc)) reviewedText.set(doc, doc.text);
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
function checkedPdfHandle(doc: LoadedDocument): PdfHandle {
  const handle = doc.handle as PdfHandle;
  const expected = handle.pages.flatMap((page, p) => page.items.map((item, i) => ({ item, p, i })));
  if (expected.length !== handle.segments.length || expected.length !== handle.itemPage.length || expected.length !== handle.itemIndex.length) throw new Error(SOURCE_CHANGED);
  let end = 0;
  for (const [index, { item, p, i }] of expected.entries()) {
    const segment = handle.segments[index];
    if (!Number.isInteger(segment.start) || !Number.isInteger(segment.end) || segment.start < end || segment.end > doc.text.length || segment.end - segment.start !== item.text.length || handle.itemPage[index] !== p || handle.itemIndex[index] !== i || segment.text !== item.text || doc.text.slice(segment.start, segment.end) !== item.text || doc.text.slice(end, segment.start).trim()) throw new Error(SOURCE_CHANGED);
    end = segment.end;
  }
  if (doc.text.slice(end).trim()) throw new Error(SOURCE_CHANGED);
  return { ...handle, segments: handle.segments.map((segment) => ({ ...segment })), itemPage: [...handle.itemPage], itemIndex: [...handle.itemIndex], pages: handle.pages.map((page) => ({ ...page, items: page.items.map((item) => ({ ...item })), pictures: [] })) };
}

async function sanitizeOffice(zip: JSZip, format: 'docx' | 'xlsx'): Promise<void> {
  (zip as JSZip & { comment: string }).comment = '';
  const styleIds = new Map<string, string>();
  let labelId = 0;
  const safeStyle = (value: string) => { if (!styleIds.has(value)) styleIds.set(value, `SafeStyle${styleIds.size + 1}`); return styleIds.get(value)!; };
  for (const entry of Object.values(zip.files)) {
    entry.comment = '';
    if (entry.dir) continue;
    if (META.test(entry.name)) { zip.remove(entry.name); continue; }
    const part = xml(await entry.async('string'));
    for (const el of Array.from(part.getElementsByTagName('*'))) {
      // These attributes describe edit history/authorship rather than document content.
      for (const attr of Array.from(el.attributes)) {
        if (authorAttribute(attr)) { el.removeAttributeNode(attr); continue; }
        if (format === 'docx' && neutralWordAttribute(el, attr)) attr.value = el.localName === 'style' || STYLE_REFS.has(el.localName) ? safeStyle(attr.value) : ['font', 'rFonts', 'altName', 'latin', 'ea', 'cs'].includes(el.localName) || attr.localName === 'typeface' ? 'Noto Sans TC' : `中性樣式${++labelId}`;
        if (format === 'xlsx' && neutralXlsxAttribute(el, attr)) attr.value = el.localName === 'name' || attr.localName === 'typeface' ? 'Noto Sans TC' : `中性樣式${++labelId}`;
        if (format === 'xlsx' && attr.localName === 'codeName' && ['workbookPr', 'sheetPr', 'fileVersion'].includes(el.localName)) el.removeAttributeNode(attr);
        if (format === 'xlsx' && el.localName === 'fileVersion' && attr.localName === 'appName') attr.value = 'xl';
      }
      if (entry.name === '[Content_Types].xml' && el.localName === 'Override' && META.test((el.getAttribute('PartName') ?? '').replace(/^\//, ''))) el.remove();
      if (entry.name.endsWith('.rels') && el.localName === 'Relationship' && /\/(core-properties|extended-properties|custom-properties)$/.test(el.getAttribute('Type') ?? '')) el.remove();
    }
    if (format === 'xlsx' && entry.name === 'xl/workbook.xml') Array.from(part.getElementsByTagNameNS(X, 'sheet')).forEach((sheet, i) => sheet.setAttribute('name', `中性工作表${i + 1}`));
    zip.file(entry.name, new XMLSerializer().serializeToString(part));
  }
}

export async function generateSafeDocument(doc: LoadedDocument, edits: TextEdit[], _report: FormatSafetyReport): Promise<Blob> {
  if (reviewedText.has(doc) && reviewedText.get(doc) !== doc.text) throw new Error(SOURCE_CHANGED);
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
    if (fresh.text !== doc.text) throw new Error(SOURCE_CHANGED);
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
    const safeDoc = { ...doc, handle: checkedPdfHandle(doc) };
    const output = await generateDocument(safeDoc, edits);
    const parsed = await parseDocument(new File([output], 'document.pdf'));
    rejectRemnants([parsed.text], originals);
    return output;
  }
  const output = await generateDocument(doc, edits);
  rejectRemnants([await output.text()], originals);
  return output;
}
