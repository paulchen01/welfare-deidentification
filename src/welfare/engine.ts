import { detect } from '../core/detector';
import { BUILTIN_PATTERNS } from '../core/patterns';
import type { TextEdit } from '../core/types';
import type { DetectionConfig, Person, WelfareFinding } from './types';
import { PERSON_ROLES } from './policies';
import { detectLocalIdentifiers } from './local-identifiers';
import { proposeNarrativeNames, shortNameVariants } from './narrative';

const NOTICE = '規則建議，請逐項覆核；無法保證已找出所有敏感資訊。';
/** Appended to every rule message; the review list shows it once instead of on every row. */
export const REVIEW_NOTICE = NOTICE;
const CONTEXTS = new Set(['健康資訊', '保護資訊', '經濟資訊', '職業', '日期', '年齡', '金額']);
const STAFF_ROLES = new Set(['社工', '督導']);
const LABELS = '個案姓名|服務對象|主要照顧者|監護人|通報人|案主|案父|案母|社工|督導|姓名|暱稱|綽號';
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HEALTH_TERMS = new RegExp([
  '思覺失調症', '重度憂鬱症', '憂鬱症', '躁鬱症', '雙相情緒障礙', '焦慮症', '恐慌症', '強迫症', '創傷後壓力症候群', '自閉症', '亞斯伯格症',
  '注意力不足過動症', '過動症', '智能障礙', '發展遲緩', '唐氏症', '腦性麻痺', '失智症', '帕金森氏症', '中風', '糖尿病', '高血壓', '心臟病',
  '腎衰竭', '洗腎', '癌症', '肝硬化', '肝炎', '結核病', '愛滋病', '酒癮', '毒癮', '藥癮', '自殺未遂', '自傷行為',
].join('|'), 'gu');
const PLACE_SUFFIX = /國民小學|國民中學|實驗小學|高級中學|國小|國中|高中|高職|小學|大學|醫院|療養院|診所|養護中心|安養中心|護理之家|安置中心|基金會|協會|庇護工場|托兒所|幼兒園|[村里](?:\d{1,3}鄰)?/gu;
/** Verbs and particles that end the lead-in before a place name (就讀、居住於、到). */
const PLACE_LEAD = /就讀於|就讀|轉學到|轉學至|轉到|轉入|考上|升上|進入|居住在|居住於|居住|住在|住於|搬到|搬至|位於|前往|來自|陪同|在|於|到|至|往|從|自|的|讀|念|唸|去|與|和|及|或/gu;
const NUMERAL = /[0-9０-９一二兩三四五六七八九十百千萬]/u;

/**
 * Where the place name starts inside the Han run before its suffix, or undefined when the run is only
 * narrative (「就讀大學」 has no proper name). A one-character particle at the very start may belong to
 * the name itself (「自強國小」), so it is skipped when it would leave fewer than two characters.
 */
function placeNameStart(run: string): number | undefined {
  const leads = [...run.matchAll(PLACE_LEAD)].map(m => ({ end: m.index! + m[0].length, multi: m[0].length > 1 }));
  for (const end of [...new Set(leads.map(l => l.end))].sort((a, b) => b - a)) {
    if (run.length - end >= 2) return end;
    if (leads.some(l => l.end === end && l.multi)) return undefined;
  }
  return run.length >= 2 ? 0 : undefined;
}

/** Proper place names before a suffix, without the preceding narrative. */
function findPlaceNames(text: string): { start: number; end: number; category: '機構' | '村里' }[] {
  const out: { start: number; end: number; category: '機構' | '村里' }[] = [];
  let previousEnd = 0;
  for (const m of text.matchAll(PLACE_SUFFIX)) {
    const village = /^[村里]/u.test(m[0]), max = village ? 6 : 15;
    // Never reach back into an earlier place: 「自強國小與台大醫院」 is two names.
    let begin = m.index!;
    while (begin > previousEnd && m.index! - begin < max && /\p{Script=Han}/u.test(text[begin - 1])) begin--;
    previousEnd = m.index! + m[0].length;
    const lead = placeNameStart(text.slice(begin, m.index!));
    if (lead === undefined) continue;
    const name = text.slice(begin + lead, m.index!);
    if (name.length < 2 || (village ? name.length > 4 : name.length > 12)) continue;
    // 「五公里」「家里」 are distances or typos, not villages.
    if (village && (NUMERAL.test(name) || /[公英海千萬鄰家這那哪心]$/u.test(name))) continue;
    out.push({ start: begin + lead, end: m.index! + m[0].length, category: village ? '村里' : '機構' });
  }
  return out;
}
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
  // Narrative notes rarely label names: 「案母張王美珠」「班導陳老師」. Skip names already covered by a longer labeled proposal.
  for (const name of proposeNarrativeNames(text)) {
    if (!result.some(p => p.name === name || p.name.includes(name))) result.push({ id: `candidate-${result.length + 1}`, groupId, name, aliases: [], role: '待確認', confirmed: false });
  }
  return result;
}

function suffix(index: number): string {
  let value = index + 1, out = '';
  while (value > 0) { value--; out = String.fromCharCode(65 + value % 26) + out; value = Math.floor(value / 26); }
  return out;
}

const ageBand = (age: number) => age < 6 ? '0–5歲' : age < 12 ? '6–11歲' : age < 18 ? '12–17歲' : age < 20 ? '18–19歲' : `${Math.floor(age / 10) * 10}–${Math.floor(age / 10) * 10 + 9}歲`;
const DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 三十五 → 35, 十二 → 12, 一百零五 → 105; undefined for anything else. */
export function chineseNumber(s: string): number | undefined {
  const m = s.match(/^(?:([一二兩三四五六七八九])?百)?(?:零)?(?:([一二兩三四五六七八九])?(十))?([一二兩三四五六七八九])?$/u);
  if (!m || !s) return undefined;
  const hundreds = s.includes('百') ? DIGITS[m[1] ?? '一'] : 0;
  const tens = m[3] ? DIGITS[m[2] ?? '一'] : 0;
  return hundreds * 100 + tens * 10 + (m[4] ? DIGITS[m[4]] : 0);
}

/** A confirmed staff role cannot override an explicitly conflicting client label. */
function staffNameHasClientConflict(text: string, name: string): boolean {
  const labeledClient = new RegExp('(?:^|[\\s，,；;。])(?:案主|服務對象|個案(?:姓名)?|案父|案母|主要照顧者|監護人|家屬|通報人)[\\t ]*[:：]?[\\t ]*' + escapeRegex(name) + '(?![\\p{L}])', 'u');
  return labeledClient.test(text);
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
  // Proper names right before a place suffix. The name stops at the verb or particle before it, so
  // 「目前就讀文山國小」 masks only 「文山國小」 and keeps the narrative.
  for (const place of findPlaceNames(text)) add(place.start, place.end, place.category, place.category === '機構' ? 60 : 55);
  scan(HEALTH_TERMS, '健康資訊', 9);
  scan(/性侵害|遭受家暴|遭家暴|遭性侵|遭同住者施暴|性騷擾|兒虐|保護令/gu, '保護資訊', 9);
  scan(/積欠房租|無力償還債務|中低收入戶|低收入戶|卡債/gu, '經濟資訊', 9);
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
      // A confirmed person whose role is still 待確認 reads as a neutral [人物A], not [待確認A].
      const role = PERSON_ROLES.includes(p.role) && p.role !== '待確認' ? p.role : '人物';
      const index = roles.get(role) ?? 0; roles.set(role, index + 1); replacement = marker(`${role}${suffix(index)}`);
    }
    for (const name of new Set([p.name, ...p.aliases])) {
      if (!name.trim() || name.length > 120) throw new Error('人物名稱或別名無效');
      const owners = names.get(name) ?? []; owners.push({ person: p, replacement }); names.set(name, owners);
    }
  }
  const rosterNames = new Set(names.keys());
  for (const p of proposePeople(text, config.groupId)) if (!names.has(p.name)) names.set(p.name, [{ person: p, replacement: '[姓名]' }]);
  for (const [name, owners] of names) {
    const confirmed = owners.filter(o => o.person.confirmed), ambiguous = owners.length > 1;
    const owner = !ambiguous && confirmed.length === 1 ? confirmed[0] : undefined;
    let from = 0;
    for (;;) {
      const start = text.indexOf(name, from); if (start === -1) break; from = start + name.length;
      if (/^[A-Za-z]/u.test(name) && /[A-Za-z]/u.test(text[start - 1] ?? '')) continue;
      if (/[A-Za-z]$/u.test(name) && /[A-Za-z]/u.test(text[from] ?? '')) continue;
      const verifiedStaff = !!owner && name === owner.person.name && STAFF_ROLES.has(owner.person.role) && !staffNameHasClientConflict(text, name);
      add(start, from, '姓名', 90, { source: 'person', replacement: owner?.replacement ?? '[姓名]', personId: owner?.person.id,
        action: verifiedStaff ? 'keep' : 'mask',
        message: ambiguous ? '姓名或別名歧義：同一文字對應多位人物，包含尚未確認的候選。' + NOTICE
          : verifiedStaff ? '已確認的工作人員姓名，建議保留；仍須確認其並非本案服務對象，且目前分享目的允許揭露。' + NOTICE
          : owner && STAFF_ROLES.has(owner.person.role) ? '同名可能指涉服務對象或家屬，為避免誤揭露先遮蔽。' + NOTICE : NOTICE });
    }
  }
  // Short forms of known names (張志明 → 志明、阿明). Masked generically and never linked to a person:
  // linking requires the person to add the alias in 「人物與規則」.
  const variants = new Map<string, string[]>();
  for (const name of names.keys()) for (const v of shortNameVariants(name)) if (!names.has(v)) variants.set(v, [...(variants.get(v) ?? []), name]);
  for (const [variant, fulls] of variants) {
    let from = 0;
    for (;;) {
      const start = text.indexOf(variant, from); if (start === -1) break; from = start + variant.length;
      add(start, from, '姓名', 85, { source: 'person', replacement: '[姓名]',
        message: `可能是「${fulls.join('」或「')}」的簡稱或小名；如為同一人，請在「人物與規則」加入別名。${NOTICE}` });
    }
  }
  // Keep ordinary service dates to preserve intervention chronology. Birthdays
  // and clearly sensitive incident dates remain conservative; public use is broader.
  const datePolicy = (start: number): Pick<Candidate, 'action' | 'message'> => {
    const clause = text.slice(Math.max(0, start - 35), start).split(/[。；;，,\r\n]/u).at(-1)?.trim() ?? '';
    if (/(?:出生(?:年月日|年月|日期)?|生日|生年月日)[\t ]*[:：]?[\t ]*$/u.test(clause)) {
      return { action: 'mask', message: '出生日期可能直接或間接辨識服務對象，預設遮蔽。' + NOTICE };
    }
    if (/(?:案發|事發|受暴|性侵|自殺|重大事故|保護令)(?:日期|時間)?[\t ]*[:：]?[\t ]*$/u.test(clause)) {
      return { action: config.purpose === 'internal' ? 'keep' : 'mask',
        message: '敏感事件的精確日期可能造成再識別，需逐項判斷。' + NOTICE };
    }
    return { action: config.purpose === 'public' ? 'generalize' : 'keep',
      message: '一般服務日期預設保留（公開用途建議概化）；仍需確認日期與其他線索的組合識別風險。' + NOTICE };
  };
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
    add(m.index!, m.index! + m[0].length, '日期', 30, { generalized, ...datePolicy(m.index!) });
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,3})歲(?!\d)/gu)) {
    const age = Number(m[1]); if (age > 120) continue;
    add(m.index!, m.index! + m[0].length, '年齡', 30, { generalized: ageBand(age) });
  }
  const tenDays = (day: number) => day <= 10 ? '上旬' : day <= 20 ? '中旬' : '下旬';
  const validDay = (month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  // Year and month without a day: 113年5月.
  for (const m of text.matchAll(/(?<!\d)(?:(民國)[\t ]*)?(\d{2,4})[\t ]*年[\t ]*(\d{1,2})[\t ]*月(?![\t ]*(?:\d|[上中下]旬))/gu)) {
    const roc = m[1] !== undefined || m[2].length < 4, year = Number(m[2]), month = Number(m[3]);
    if (year < 1 || month < 1 || month > 12) continue;
    add(m.index!, m.index! + m[0].length, '日期', 30, { generalized: `${roc ? '民國' : ''}${year}年${month <= 6 ? '上半年' : '下半年'}`, ...datePolicy(m.index!) });
  }
  // Month and day without a year: 5月12日、5/12.
  for (const m of text.matchAll(/(?<!年[\t ]*)(?<!\d)(\d{1,2})[\t ]*月[\t ]*(\d{1,2})[\t ]*[日號](?!\d)/gu)) {
    const month = Number(m[1]), day = Number(m[2]); if (!validDay(month, day)) continue;
    add(m.index!, m.index! + m[0].length, '日期', 30, { generalized: `${month}月${tenDays(day)}`, ...datePolicy(m.index!) });
  }
  for (const m of text.matchAll(/(?<=^|[於在至到自從約與和及、，,。；;\s（(])(\d{1,2})[/／](\d{1,2})(?![\d/／%])(?!的|之)/gu)) {
    const month = Number(m[1]), day = Number(m[2]); if (!validDay(month, day)) continue;
    add(m.index!, m.index! + m[0].length, '日期', 30, { generalized: `${month}月${tenDays(day)}`, ...datePolicy(m.index!) });
  }
  // Ages in Chinese numerals (三十五歲) and school grades (三年級), which reveal a child's age.
  for (const m of text.matchAll(/(?<![一二兩三四五六七八九十百零])([一二兩三四五六七八九十百零]{1,5})歲/gu)) {
    const age = chineseNumber(m[1]); if (age === undefined || age > 120) continue;
    add(m.index!, m.index! + m[0].length, '年齡', 30, { generalized: ageBand(age) });
  }
  for (const m of text.matchAll(/(?<![一二三四五六0-9])([一二三四五六1-6])[\t ]*年級/gu)) {
    const grade = '一二三四五六'.indexOf(m[1]) + 1 || Number(m[1]);
    const secondary = /(?:國中|高中|高職|國民中學|高級中學)[\t ]*$/u.test(text.slice(Math.max(0, m.index! - 6), m.index!));
    add(m.index!, m.index! + m[0].length, '年齡', 30, { generalized: secondary ? '在學' : grade <= 2 ? '低年級' : grade <= 4 ? '中年級' : '高年級' });
  }
  for (const m of text.matchAll(/(?:新[臺台]幣\s*)?(\d{1,3}(?:,\d{3})+|\d{2,9})\s*元/gu)) {
    const n = Number(m[1].replaceAll(',', '')), unit = n < 10000 ? 1000 : n < 100000 ? 10000 : 100000, low = Math.floor(n / unit) * unit;
    add(m.index!, m.index! + m[0].length, '金額', 30, { generalized: `${low.toLocaleString('en-US')}–${(low + unit - 1).toLocaleString('en-US')}元` });
  }
  // A corrected confirmed name/alias overrides only a temporary longer proposal
  // starting at that exact occurrence. Explicit roster entries retain their existing ordering.
  const confirmedNameEnds = new Map<number, number>();
  for (const c of candidates) if (c.category === '姓名' && c.personId) {
    confirmedNameEnds.set(c.start, Math.min(confirmedNameEnds.get(c.start) ?? c.end, c.end));
  }
  // Split sensitive context around higher-priority identifiers instead of dropping its remaining text.
  const chosen: Candidate[] = [];
  for (const c of candidates.sort((a, b) => b.priority - a.priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start)) {
    if (c.source === 'person' && !rosterNames.has(c.original) && (confirmedNameEnds.get(c.start) ?? c.end) < c.end) continue;
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
