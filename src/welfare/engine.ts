import { detect } from '../core/detector';
import { BUILTIN_PATTERNS } from '../core/patterns';
import type { TextEdit } from '../core/types';
import type { DetectionConfig, Person, WelfareFinding } from './types';
import { PERSON_ROLES } from './policies';
import { detectLocalIdentifiers } from './local-identifiers';

const NOTICE = '規則建議，請逐項覆核；無法保證已找出所有敏感資訊。';
const CONTEXTS = new Set(['健康資訊', '保護資訊', '經濟資訊', '職業', '日期', '年齡', '金額']);
const LABELS = '個案姓名|服務對象|主要照顧者|監護人|通報人|案主|案父|案母|社工|督導|姓名|暱稱|綽號';
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const intersects = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
type Candidate = WelfareFinding & { priority: number; context?: boolean };

function checkLabel(s: string): void {
  if (!s || s.length > 40 || /[\[\]<>\p{Cc}\p{Cf}]/u.test(s)) throw new Error('分類或角色標籤無效');
}
function marker(category: string): string { checkLabel(category); return `[${category}]`; }
function checkSpan(text: string, start: number, end: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start >= end) throw new Error('選取範圍無效');
  for (const offset of [start, end]) if (offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset])) throw new Error('選取範圍切斷字元');
}

/** Candidates never imply a confirmed identity, relationship or nickname linkage. */
export function proposePeople(text: string, groupId: string): Person[] {
  const result: Person[] = [];
  // The next labeled field ends a value even if its separator is a space.
  // Spaces within foreign names remain valid until that explicit field boundary.
  const re = new RegExp(`(?:${LABELS})[\\t ]*[:：][\\t ]*([\\p{Script=Han}A-Za-zÀ-ž][\\p{L}·・'’ -]{0,59}?)(?=[\\t ]+[\\p{L}]{1,20}[\\t ]*[:：]|[^\\p{L}·・'’ -]|$)`, 'gu');
  for (const m of text.matchAll(re)) {
    const name = m[1].trim().split(/(?:表示|同意|於|已|接受|診斷|目前|今年|就讀|居住|任職)/u)[0].trim();
    if (/^[\p{Script=Han}·・]+$/u.test(name) && name.length > 8) continue;
    if (name.length < 2 || /^(?:無|不詳|未提供|待確認|同上|保密|服務對象|案主)$/u.test(name)) continue;
    if (!result.some(p => p.name === name)) result.push({ id: `candidate-${result.length + 1}`, groupId, name, aliases: [], role: '待確認', confirmed: false });
  }
  const inline = new RegExp(`(?:${LABELS})([\\p{Script=Han}]{2,4})(?=先生|女士|同學)`, 'gu');
  for (const m of text.matchAll(inline)) if (!result.some(p => p.name === m[1])) result.push({ id: `candidate-${result.length + 1}`, groupId, name: m[1], aliases: [], role: '待確認', confirmed: false });
  return result;
}

function suffix(index: number): string {
  let value = index + 1, out = '';
  while (value > 0) { value--; out = String.fromCharCode(65 + value % 26) + out; value = Math.floor(value / 26); }
  return out;
}

export function detectWelfare(text: string, config: DetectionConfig): WelfareFinding[] {
  if (!['internal', 'ai', 'public'].includes(config.purpose)) throw new Error('用途無效');
  if ((config.customRules?.length ?? 0) > 50) throw new Error('機構規則數量超過上限');
  const candidates: Candidate[] = [];
  const add = (start: number, end: number, category: string, priority = 80, extras: Partial<Candidate> = {}) => {
    if (start === end) return;
    const context = CONTEXTS.has(category);
    candidates.push({ id: '', start, end, original: text.slice(start, end), category, source: 'rule',
      action: context && config.purpose === 'internal' ? 'keep' : 'mask', replacement: marker(category), reviewed: false,
      message: NOTICE, priority, context, ...extras });
  };
  const scan = (re: RegExp, category: string, priority = 80, field = false) => {
    for (const m of text.matchAll(re)) {
      const value = field ? m[1] : m[0];
      const start = m.index! + (field ? m[0].lastIndexOf(value) : 0);
      add(start, start + value.length, category, priority);
    }
  };
  // Exclude generic surname and tax-id guessing. Preserve no visible surname/digits.
  const builtinIds = new Set(['tw-id', 'us-ssn', 'tw-mobile', 'tw-landline', 'tw-address', 'email', 'intl-phone', 'credit-card', 'iban', 'ipv4', 'ipv6']);
  for (const hit of detect(text, BUILTIN_PATTERNS.filter(p => builtinIds.has(p.id)))) add(hit.start, hit.end, hit.category, 100);
  scan(/(?:身分證(?:字號)?|身份證(?:字號)?)[\t ]*[:：]?[\t ]*([A-Za-z][12]\d{8})(?!\d)/gu, '身分證', 115, true);
  scan(/(?<![A-Za-z0-9])(?:[A-Z][89]\d{8}|[A-Z][A-D]\d{8})(?![A-Za-z0-9])/gu, '居留證', 110);
  scan(/(?:銀行帳號|郵局帳號|金融帳號|匯款帳號|存款帳號|帳號)[\t ]*[:：][\t ]*(\d(?:[\d -]{4,30}\d))(?!\d)/gu, '銀行帳號', 120, true);
  for (const hit of detectLocalIdentifiers(text)) add(hit.start, hit.end, hit.category, 121, { message: `${hit.message}${NOTICE}` });
  const fields: [string, string][] = [
    ['案號|個案編號|案件編號|服務編號', '案號'], ['通報編號|通報案號|通報號', '通報編號'],
    ['病歷號(?:碼)?|病歷編號', '病歷號'], ['公文文號|公文號|發文字號|文號', '公文文號'], ['安置編號|安置案號', '安置編號'],
  ];
  for (const [label, category] of fields) scan(new RegExp(`(?:${label})[\\t ]*[:：][\\t ]*([\\p{L}\\d][\\p{L}\\d._/-]{1,63})`, 'gu'), category, 120, true);
  const ordinaryFields: [string, string][] = [
    ['服務機構|安置機構|機構名稱|機構', '機構'], ['就讀學校|學校名稱|學校', '學校'], ['就醫醫院|醫院名稱|醫院', '醫院'],
    ['居住里|居住村|村里|里別|鄰里', '村里'], ['職業|工作職稱|任職工作', '職業'],
    ['健康狀況|醫療資訊|診斷|病史|身心狀況', '健康資訊'], ['保護事項|保護資訊|受暴情形|家暴情形|性侵情形', '保護資訊'], ['經濟狀況|經濟資訊|債務情形', '經濟資訊'],
  ];
  for (const [label, category] of ordinaryFields) scan(new RegExp(`(?:${label})[\\t ]*[:：][\\t ]*([^，,；;。\\r\\n\\t]{1,160})`, 'gu'), category, CONTEXTS.has(category) ? 10 : 70, true);
  scan(/(?<![\p{Script=Han}])(?:[\p{Script=Han}]{2,15})(?:國民小學|國民中學|國小|國中|高中|大學|醫院|療養院|養護中心|安置中心|基金會|庇護工場)/gu, '機構', 60);
  scan(/(?<![\p{Script=Han}])[\p{Script=Han}]{2,5}[村里](?:\d{1,3}鄰)?/gu, '村里', 55);
  scan(/思覺失調症|重度憂鬱症|憂鬱症|躁鬱症|愛滋病|自殺未遂|自傷行為/gu, '健康資訊', 9);
  scan(/性侵害|遭受家暴|遭家暴|遭性侵|遭同住者施暴/gu, '保護資訊', 9);
  scan(/積欠房租|無力償還債務/gu, '經濟資訊', 9);
  for (const rule of config.customRules ?? []) {
    checkLabel(rule.label);
    if (typeof rule.prefix !== 'string' || rule.prefix.length < 1 || rule.prefix.length > 64 || !/^[\p{L}\p{N} ._/-]+$/u.test(rule.prefix)
      || !Number.isInteger(rule.minDigits) || !Number.isInteger(rule.maxDigits) || rule.minDigits < 1 || rule.maxDigits > 24 || rule.maxDigits < rule.minDigits) throw new Error('機構規則需為有限文字前綴與 1–24 位數');
    scan(new RegExp(`${escapeRegex(rule.prefix)}\\d{${rule.minDigits},${rule.maxDigits}}(?!\\d)`, 'gu'), rule.label, 125);
  }
  const roles = new Map<string, number>();
  const names = new Map<string, { person: Person; replacement: string }[]>();
  const ids = new Set<string>();
  for (const p of config.people.filter(p => p.groupId === config.groupId)) {
    if (!p.id || ids.has(p.id)) throw new Error('同一案件的人物識別碼不可重複');
    ids.add(p.id);
    let replacement = '[姓名]';
    if (p.confirmed) {
      const role = PERSON_ROLES.includes(p.role) ? p.role : '人物';
      const index = roles.get(role) ?? 0; roles.set(role, index + 1); replacement = marker(`${role}${suffix(index)}`);
    }
    for (const name of new Set([p.name, ...p.aliases])) {
      if (!name.trim() || name.length > 120) throw new Error('人物名稱或別名無效');
      const owners = names.get(name) ?? []; owners.push({ person: p, replacement }); names.set(name, owners);
    }
  }
  for (const p of proposePeople(text, config.groupId)) if (!names.has(p.name)) names.set(p.name, [{ person: p, replacement: '[姓名]' }]);
  for (const [name, owners] of names) {
    const confirmed = owners.filter(o => o.person.confirmed), ambiguous = owners.length > 1;
    const owner = !ambiguous && confirmed.length === 1 ? confirmed[0] : undefined;
    let from = 0;
    for (;;) {
      const start = text.indexOf(name, from); if (start === -1) break; from = start + name.length;
      if (/^[A-Za-z]/u.test(name) && /[A-Za-z]/u.test(text[start - 1] ?? '')) continue;
      if (/[A-Za-z]$/u.test(name) && /[A-Za-z]/u.test(text[from] ?? '')) continue;
      add(start, from, '姓名', 90, { source: 'person', replacement: owner?.replacement ?? '[姓名]', personId: owner?.person.id,
        message: ambiguous ? `姓名或別名歧義：同一文字對應多位人物，包含尚未確認的候選。${NOTICE}` : NOTICE });
    }
  }
  for (const m of text.matchAll(/(?<!\d)(?:(民國)[\t ]*)?(\d{2,4})[\t ]*(?:年|[-/.])[\t ]*(\d{1,2})[\t ]*(?:月|[-/.])[\t ]*(\d{1,2})(?:[\t ]*日)?(?!\d)/gu)) {
    // An explicit ROC prefix takes precedence; otherwise four digits denote CE,
    // and the supported two/three-digit local date forms denote ROC.
    const roc = m[1] !== undefined || m[2].length < 4;
    const year = Number(m[2]), month = Number(m[3]), day = Number(m[4]), ceYear = roc ? year + 1911 : year;
    if (year < 1) continue;
    const date = new Date(0);
    date.setUTCFullYear(ceYear, month - 1, day);
    if (date.getUTCFullYear() !== ceYear || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
    const generalized = `${roc ? '民國' : ''}${year}年${month}月${day <= 10 ? '上旬' : day <= 20 ? '中旬' : '下旬'}`;
    add(m.index!, m.index! + m[0].length, '日期', 30, { generalized, action: config.purpose === 'public' ? 'generalize' : config.purpose === 'internal' ? 'keep' : 'mask' });
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,3})歲(?!\d)/gu)) {
    const age = Number(m[1]); if (age > 120) continue;
    const band = age < 6 ? '0–5歲' : age < 12 ? '6–11歲' : age < 18 ? '12–17歲' : age < 20 ? '18–19歲' : `${Math.floor(age / 10) * 10}–${Math.floor(age / 10) * 10 + 9}歲`;
    add(m.index!, m.index! + m[0].length, '年齡', 30, { generalized: band });
  }
  for (const m of text.matchAll(/(?:新[臺台]幣\s*)?(\d{1,3}(?:,\d{3})+|\d{2,9})\s*元/gu)) {
    const n = Number(m[1].replaceAll(',', '')), unit = n < 10000 ? 1000 : n < 100000 ? 10000 : 100000, low = Math.floor(n / unit) * unit;
    add(m.index!, m.index! + m[0].length, '金額', 30, { generalized: `${low.toLocaleString('en-US')}–${(low + unit - 1).toLocaleString('en-US')}元` });
  }
  // Split sensitive context around higher-priority identifiers instead of dropping its remaining text.
  const chosen: Candidate[] = [];
  for (const c of candidates.sort((a, b) => b.priority - a.priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start)) {
    if (c.category === '姓名') { if (chosen.every(k => !intersects(c, k))) chosen.push(c); continue; }
    let segments = [{ start: c.start, end: c.end }];
    for (const k of chosen) segments = segments.flatMap(s => !intersects(s, k) ? [s] : [{ start: s.start, end: Math.min(s.end, k.start) }, { start: Math.max(s.start, k.end), end: s.end }].filter(s => s.start < s.end));
    for (const segment of segments) {
      const whole = segment.start === c.start && segment.end === c.end;
      chosen.push({ ...c, ...segment, original: text.slice(segment.start, segment.end), generalized: whole ? c.generalized : undefined, action: c.action === 'generalize' && !whole ? 'mask' : c.action });
    }
  }
  return chosen.sort((a, b) => a.start - b.start).map(({ priority: _priority, context: _context, ...f }, i) => ({ ...f, id: `finding-${i + 1}-${f.start}-${f.end}` }));
}

export function createManualFinding(text: string, start: number, end: number, category: string, existing: WelfareFinding[]): WelfareFinding {
  checkSpan(text, start, end); checkLabel(category); findingsToEdits(text, existing);
  if (existing.some(f => intersects({ start, end }, f))) throw new Error('選取範圍與既有項目重疊');
  return { id: `manual-${start}-${end}`, start, end, original: text.slice(start, end), category, source: 'manual', action: 'mask', replacement: marker(category), reviewed: true };
}
export function findingsToEdits(text: string, findings: WelfareFinding[]): TextEdit[] {
  const ordered = [...findings].sort((a, b) => a.start - b.start), edits: TextEdit[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i]; checkSpan(text, f.start, f.end);
    if (text.slice(f.start, f.end) !== f.original) throw new Error('原文或位置已變動，請重新偵測');
    if (i && ordered[i - 1].end > f.start) throw new Error('項目範圍重疊');
    if (!['keep', 'mask', 'generalize'].includes(f.action)) throw new Error('處理方式無效');
    if (f.action === 'keep') continue;
    let replacement: string;
    if (f.action === 'mask') {
      replacement = f.replacement;
      if (!/^\[[^\[\]<>\p{Cc}\p{Cf}]{1,60}\]$/u.test(replacement)) throw new Error('遮蔽標記無效');
    } else {
      if (!f.generalized || /[\[\]<>\p{Cc}\p{Cf}]/u.test(f.generalized) || f.generalized.length > 120) throw new Error('此項沒有可用的概化建議');
      replacement = f.generalized;
    }
    edits.push({ start: f.start, end: f.end, replacement });
  }
  return edits;
}
export function renderText(text: string, findings: WelfareFinding[]): string {
  let out = '', offset = 0;
  for (const edit of findingsToEdits(text, findings)) { out += text.slice(offset, edit.start) + edit.replacement; offset = edit.end; }
  return out + text.slice(offset);
}
