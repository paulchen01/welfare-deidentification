import { describe, expect, it } from 'vitest';
import { createManualFinding, detectWelfare, findingsToEdits, proposePeople, renderText } from '../../src/welfare/engine';
import { WELFARE_SAMPLES } from '../../src/welfare/samples';
import type { DetectionConfig, Person } from '../../src/welfare/types';

const cfg = (people: Person[] = [], purpose: DetectionConfig['purpose'] = 'ai'): DetectionConfig => ({ groupId: 'case-1', purpose, people });
const person = (id: string, name: string, role = '服務對象', aliases: string[] = [], groupId = 'case-1', confirmed = true): Person => ({ id, name, role, aliases, groupId, confirmed });
const redact = (text: string, config = cfg()) => renderText(text, detectWelfare(text, config));

describe('social welfare de-identification', () => {
  it('uses canonical names and explicit aliases with one readable identity marker', () => {
    const text = '王小明和小明會談，王小明同意繼續服務。';
    const findings = detectWelfare(text, cfg([person('p1', '王小明', '服務對象', ['小明'])]));
    expect(findings.map(f => f.replacement)).toEqual(['[服務對象A]', '[服務對象A]', '[服務對象A]']);
    expect(renderText(text, findings)).toBe('[服務對象A]和[服務對象A]會談，[服務對象A]同意繼續服務。');
  });
  it('assigns separate role suffixes and supports foreign multi-part names', () => {
    expect(redact('Maria de la Cruz 與 陳怡安。', cfg([person('a', 'Maria de la Cruz', '母親'), person('b', '陳怡安', '母親')]))).toBe('[母親A] 與 [母親B]。');
  });
  it('marks ambiguous aliases generically without a person identity', () => {
    const f = detectWelfare('小安', cfg([person('a', '王安', '母親', ['小安']), person('b', '李安', '父親', ['小安'])]));
    expect(f).toHaveLength(1);
    expect(f[0].replacement).toBe('[姓名]');
    expect(f[0].personId).toBeUndefined();
    expect(f[0].message).toMatch(/歧義|重複/);
  });
  it('isolates groups and does not use unconfirmed role relationships', () => {
    const people = [person('a', '王小明', '母親', [], 'other'), person('b', '林美慧', '母親', [], 'case-1', false)];
    expect(redact('王小明；林美慧', cfg(people))).toBe('王小明；[姓名]');
  });
  it('proposes labeled names without claiming confirmation or relationships', () => {
    const ps = proposePeople('案主：陳美玲；案母：林秀英；社工：歐陽晨；暱稱：小美。', 'g');
    expect(ps.map(p => p.name)).toEqual(['陳美玲', '林秀英', '歐陽晨', '小美']);
    expect(ps.every(p => !p.confirmed && p.groupId === 'g' && p.aliases.length === 0 && p.role === '待確認')).toBe(true);
  });
  it('masks detected unconfirmed labeled names wherever repeated', () => {
    expect(redact('案主：王小明。王小明同意服務。')).toBe('案主：[姓名]。[姓名]同意服務。');
  });
  it('does not guess ordinary Chinese prose as names', () => {
    const text = '高雄方案採用社區工作方法，家庭支持持續進行，林業與文化活動可供討論。';
    expect(redact(text)).toBe(text);
  });
  it('preserves service narrative after role words instead of proposing it as a name', () => {
    const text = '尊重服務對象的選擇。案主同意服務。社工持續追蹤。';
    expect(proposePeople(text, 'g')).toEqual([]);
    expect(redact(text)).toBe(text);
  });
  it('never lets a short numeric alias expose the rest of a direct identifier', () => {
    const text = '銀行帳號：0123456789012；手機：0912345678';
    const result = redact(text, cfg([person('a', '阿明', '服務對象', ['12'])]));
    expect(result).not.toContain('345678');
    expect(result).not.toContain('9012');
  });
  it('preserves spaces adjoining dates and rejects invalid calendar dates', () => {
    expect(redact('於 2026-10-02 訪視。')).toBe('於 [日期] 訪視。');
    expect(redact('2026-02-30')).toBe('2026-02-30');
  });
  it('fully masks identifiers, phone variants, email, ARC and labeled accounts', () => {
    const text = '身分證：A123456789；居留證：AB12345678；手機0912-345-678；市話(02)2712-3456；信箱ann@example.org；銀行帳號：012-3456789012';
    const out = redact(text);
    for (const sensitive of ['A123456789', 'AB12345678', '0912', '3456789012', 'ann@example.org', '2712']) expect(out).not.toContain(sensitive);
    expect(out).toContain('[居留證]');
  });
  it('detects welfare identifiers and institution, location, occupation labels', () => {
    const text = '案號：SW-2026-00031；通報編號：RPT888888；病歷號：H765432；公文文號：府社字1150102001號；安置編號：PL001122；學校：晨星國小；醫院：安禾醫院；機構：希望之家；居住里：幸福里；職業：夜班保全';
    const out = redact(text);
    for (const s of ['SW-2026-00031', 'RPT888888', 'H765432', '府社字1150102001號', 'PL001122', '晨星國小', '安禾醫院', '希望之家', '幸福里', '夜班保全']) expect(out).not.toContain(s);
  });
  it('keeps necessary internal contexts for review and masks external contexts', () => {
    const text = '健康狀況：思覺失調症；保護事項：遭同住者施暴；經濟狀況：積欠房租。後續安排定期訪視。';
    const internal = detectWelfare(text, cfg([], 'internal'));
    expect(internal.filter(f => ['健康資訊', '保護資訊', '經濟資訊'].includes(f.category))).toHaveLength(3);
    expect(internal.every(f => !f.reviewed)).toBe(true);
    expect(renderText(text, internal)).toBe(text);
    expect(redact(text)).not.toContain('思覺失調症');
    expect(redact(text)).toContain('後續安排定期訪視。');
  });
  it('marks automatically detected labeled values as rule suggestions for purpose reanalysis', () => {
    const text = '健康狀況：思覺失調症；職業：夜班保全；案號：SW20260001';
    for (const purpose of ['internal', 'ai', 'public'] as const) {
      const findings = detectWelfare(text, cfg([], purpose));
      expect(findings.every(f => f.source === 'rule')).toBe(true);
      expect(findings.find(f => f.category === '健康資訊')?.action).toBe(purpose === 'internal' ? 'keep' : 'mask');
    }
  });
  it('categorizes unlabeled protective, clinical and economic indicators separately', () => {
    const text = '討論思覺失調症、遭同住者施暴與積欠房租。';
    expect(detectWelfare(text, cfg()).map(f => f.category)).toEqual(['健康資訊', '保護資訊', '經濟資訊']);
  });
  it('public dates and ages offer justified coarse generalization', () => {
    const text = '2026年10月02日及2026-10-23訪視，案主37歲，補助金額：12800元。';
    const fs = detectWelfare(text, cfg([], 'public'));
    const dates = fs.filter(f => f.category === '日期');
    expect(dates.map(f => f.generalized)).toEqual(['2026年10月上旬', '2026年10月下旬']);
    expect(fs.find(f => f.category === '年齡')?.generalized).toBe('30–39歲');
    const money = fs.find(f => f.category === '金額');
    expect(money?.generalized).toBeTruthy();
    expect(money?.action).toBe('mask');
    expect(renderText(text, dates.map(f => ({ ...f, action: 'generalize' as const })))).toContain('2026年10月上旬及2026年10月下旬');
  });
  it('resolves contexts around direct identifiers without leaving their surrounding sensitive passage', () => {
    const text = '健康狀況：王小明診斷為憂鬱症。';
    const fs = detectWelfare(text, cfg([person('a', '王小明')]));
    expect(fs.find(f => f.personId === 'a')?.original).toBe('王小明');
    expect(redact(text, cfg([person('a', '王小明')]))).not.toContain('憂鬱症');
    expect(fs.every((f, i) => !i || fs[i - 1].end <= f.start)).toBe(true);
  });
  it('accepts only bounded literal institution prefixes', () => {
    const config = { ...cfg(), customRules: [{ id: 'r', label: '機構案碼', prefix: 'ABC.', minDigits: 3, maxDigits: 4 }] };
    expect(redact('ABC.123 ABCX123', config)).toBe('[機構案碼] ABCX123');
    for (const patch of [{ prefix: 'x'.repeat(65) }, { prefix: '(a+)+' }, { minDigits: 0 }, { maxDigits: 100 }, { minDigits: 5, maxDigits: 4 }]) {
      expect(() => detectWelfare('text', { ...config, customRules: [{ ...config.customRules[0], ...patch }] })).toThrow();
    }
  });
  it('is deterministic including finding ids', () => {
    const text = '案主：王小明，0912345678；2026-10-02。';
    expect(detectWelfare(text, cfg())).toEqual(detectWelfare(text, cfg()));
  });
});

describe('safe text edits', () => {
  it('creates reviewed manual findings and rejects invalid or overlapping selections', () => {
    const f = createManualFinding('敏感內容', 0, 2, '自訂', []);
    expect(f.reviewed).toBe(true);
    expect(renderText('敏感內容', [f])).toBe('[自訂]內容');
    for (const [a,b] of [[-1,2],[0,9],[2,2],[0.5,2]]) expect(() => createManualFinding('敏感內容', a,b,'自訂',[])).toThrow();
    expect(() => createManualFinding('敏感內容', 1,3,'自訂',[f])).toThrow();
  });
  it('rejects stale offsets, overlaps and invalid replacement bracket controls', () => {
    const f = createManualFinding('敏感內容', 0, 2, '自訂', []);
    expect(() => findingsToEdits('別的內容', [f])).toThrow();
    expect(() => findingsToEdits('敏感內容', [f, { ...f, id: 'b' }])).toThrow();
    for (const replacement of ['[姓名', '姓名]', '[姓名]\n', '[姓名][額外]', '<script>', '[姓名\u202e]']) expect(() => findingsToEdits('敏感內容', [{ ...f, replacement }])).toThrow();
    expect(() => findingsToEdits('敏感內容', [{ ...f, action: 'generalize' }])).toThrow();
    expect(findingsToEdits('敏感內容', [{ ...f, action: 'keep' }])).toEqual([]);
  });
  it('rejects selections that split a surrogate pair', () => {
    expect(() => createManualFinding('🙂人', 1,2,'自訂',[])).toThrow();
  });
});

describe('synthetic welfare corpus', () => {
  it('contains at least ten cases per each of six domains', () => {
    expect(WELFARE_SAMPLES.length).toBeGreaterThanOrEqual(60);
    const counts = new Map<string, number>();
    for (const s of WELFARE_SAMPLES) counts.set(s.domain, (counts.get(s.domain) ?? 0) + 1);
    expect(counts.size).toBe(6);
    expect([...counts.values()].every(n => n >= 10)).toBe(true);
  });
  it('masks explicitly annotated sensitive values for every corpus case', () => {
    for (const sample of WELFARE_SAMPLES) {
      expect(sample.expectedSensitive.length).toBeGreaterThanOrEqual(5);
      const out = redact(sample.text, { purpose: 'ai', groupId: sample.people[0].groupId, people: sample.people });
      for (const value of sample.expectedSensitive) {
        expect(sample.text, sample.id).toContain(value);
        expect(out, `${sample.id}: ${value}`).not.toContain(value);
      }
    }
  });
  it('preserves the synthetic corpus substantive closing sentences', () => {
    for (const sample of WELFARE_SAMPLES) {
      const prose = sample.text.split('\n').at(-1)!;
      expect(redact(sample.text, { purpose: 'ai', groupId: sample.people[0].groupId, people: sample.people })).toContain(prose);
    }
  });
});
