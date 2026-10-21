import { describe, expect, it } from 'vitest';
import { chineseNumber, detectWelfare, proposePeople, renderText } from '../../src/welfare/engine';
import { proposeNarrativeNames, shortNameVariants, suggestAliases, suggestRole } from '../../src/welfare/narrative';
import type { DetectionConfig, Person } from '../../src/welfare/types';

const cfg = (people: Person[] = [], purpose: DetectionConfig['purpose'] = 'ai'): DetectionConfig => ({ groupId: 'case-1', purpose, people });
const redact = (text: string, config = cfg()) => renderText(text, detectWelfare(text, config));
const person = (patch: Partial<Person> = {}): Person => ({ id: 'p', groupId: 'case-1', name: '張志明', aliases: [], role: '服務對象', confirmed: true, ...patch });

// Synthetic narrative note in the style social workers write; all names are fictional.
const NOTE = [
  '案主：張志明（男，35歲），居住於新生里。',
  '113年5月家訪，張志明表示近期失業，積欠房租約3個月。',
  '案母張王美珠，大家都叫她阿珠，患有糖尿病。案母表示志明小時候很乖。',
  '案主的兒子張小豪目前就讀文山國小三年級，班導陳老師反映小豪常遲到。',
  '社工於5/12陪同案主走了五公里到區公所申請急難救助。',
  '三十五歲的案主過去擔任作業員。',
].join('\n');

describe('narrative case notes', () => {
  it('masks unlabeled names, short forms, dates, ages and health terms in a narrative note', () => {
    const out = redact(NOTE);
    for (const s of ['張志明', '張王美珠', '阿珠', '志明', '張小豪', '小豪', '陳老師', '文山國小', '新生里', '糖尿病', '113年5月', '5/12', '三十五歲', '三年級']) {
      expect(out, s).not.toContain(s);
    }
  });
  it('keeps the narrative around places instead of swallowing the sentence', () => {
    const out = redact(NOTE);
    expect(out).toContain('居住於[村里]');
    expect(out).toContain('案主的兒子[姓名]目前就讀[機構]');
    expect(out).toContain('走了五公里到區公所');
  });
  it('proposes narrative names as unconfirmed candidates without roles', () => {
    const people = proposePeople(NOTE, 'g');
    expect(people.map(p => p.name)).toEqual(['張志明', '張王美珠', '張小豪', '陳老師']);
    expect(people.every(p => !p.confirmed && p.role === '待確認' && p.aliases.length === 0)).toBe(true);
  });
  it('does not propose ordinary prose after role words or surname characters', () => {
    for (const text of ['尊重服務對象的選擇。案主同意服務。社工持續追蹤。', '社工陳述，母親曾表示會配合。', '對方阿姨很熱心。', '案母表示同意。']) {
      expect(proposeNarrativeNames(text), text).toEqual([]);
      expect(redact(text), text).toBe(text);
    }
  });
  it('never links a short form to a confirmed person automatically', () => {
    const text = '張志明同意服務，志明下週再談。';
    const fs = detectWelfare(text, cfg([person()]));
    const short = fs.find(f => f.original === '志明')!;
    expect(short.replacement).toBe('[姓名]');
    expect(short.personId).toBeUndefined();
    expect(short.message).toContain('張志明');
    expect(renderText(text, fs)).toBe('[服務對象A]同意服務，[姓名]下週再談。');
  });
  it('uses the person marker once the short form is added as an alias', () => {
    expect(redact('張志明同意服務，志明下週再談。', cfg([person({ aliases: ['志明'] })]))).toBe('[服務對象A]同意服務，[服務對象A]下週再談。');
  });
  it('derives short forms only from Han names with a two-character given name', () => {
    expect(shortNameVariants('張志明')).toEqual(['志明', '小明', '阿明']);
    expect(shortNameVariants('張王美珠')).toEqual(['美珠', '小珠', '阿珠']);
    expect(shortNameVariants('歐陽志明')).toEqual(['志明', '小明', '阿明']);
    expect(shortNameVariants('李明')).toEqual([]);
    expect(shortNameVariants('Maria Santos')).toEqual([]);
  });
});

describe('place names', () => {
  it('masks only the proper name before an institution or village suffix', () => {
    expect(redact('目前就讀文山國小。')).toBe('目前就讀[機構]。');
    expect(redact('和平國小、自強國小與台大醫院')).toBe('[機構]、[機構]與[機構]');
    expect(redact('居住於新生里3鄰')).toBe('居住於[村里]');
  });
  it('ignores generic schools, distances and 里 used as 裡', () => {
    for (const text of ['就讀大學後升上國中', '走了五公里', '回到家里，在這里', '鄰里關係良好']) expect(redact(text), text).toBe(text);
  });
});

describe('dates, ages and health terms', () => {
  it('detects year-month, month-day and slash dates with coarse generalizations', () => {
    const text = '113年5月家訪，5月12日與6/30再訪。';
    const fs = detectWelfare(text, cfg([], 'public')).filter(f => f.category === '日期');
    expect(fs.map(f => [f.original, f.generalized])).toEqual([['113年5月', '民國113年上半年'], ['5月12日', '5月中旬'], ['6/30', '6月下旬']]);
  });
  it('does not treat ratios or already generalized dates as new dates', () => {
    for (const text of ['約1/2的家庭', '2026年10月上旬訪視', '民國113年上半年']) {
      expect(detectWelfare(text, cfg()).filter(f => f.category === '日期'), text).toEqual([]);
    }
  });
  it('reads ages in Chinese numerals and school grades', () => {
    expect(chineseNumber('三十五')).toBe(35);
    expect(chineseNumber('十二')).toBe(12);
    expect(chineseNumber('一百零五')).toBe(105);
    expect(chineseNumber('兩')).toBe(2);
    const fs = detectWelfare('三十五歲，國小三年級，國中二年級', cfg([], 'public')).filter(f => f.category === '年齡');
    expect(fs.map(f => f.generalized)).toEqual(['30–39歲', '中年級', '在學']);
  });
  it('detects common chronic and developmental conditions', () => {
    expect(redact('患有糖尿病與高血壓，孩子有發展遲緩。')).toBe('患有[健康資訊]與[健康資訊]，孩子有[健康資訊]。');
  });
});

describe('person editor suggestions', () => {
  it('suggests the role written right before a name without applying it', () => {
    expect(suggestRole(NOTE, '張志明')).toBe('服務對象');
    expect(suggestRole('案母：林秀英', '林秀英')).toBe('母親');
    expect(suggestRole('今天林秀英來電', '林秀英')).toBeUndefined();
  });
  it('suggests aliases that appear on their own, not inside the full name', () => {
    expect(suggestAliases(NOTE, '張志明', [])).toEqual([{ alias: '志明', count: 1 }]);
    expect(suggestAliases(NOTE, '張王美珠', [])).toEqual([{ alias: '阿珠', count: 1 }]);
    expect(suggestAliases(NOTE, '張志明', ['志明'])).toEqual([]);
  });
});
