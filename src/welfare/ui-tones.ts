import type { WelfareFinding } from './types';
import { PERSON_ROLES } from './policies';

/**
 * One colour family per kind of information, shared by the original-text highlight, the replacement
 * token in the processed text and the review list, so a reader can follow one item across all three.
 */
export type Tone = 'person' | 'contact' | 'id' | 'sensitive' | 'place' | 'time' | 'other';

const TONES: [Tone, string[]][] = [
  ['person', ['姓名']],
  ['contact', ['手機', '市話', '國際電話', '電子郵件', 'LINE ID', 'IP', '聯絡資訊']],
  ['id', ['身分證', '居留證', '統編', '識別碼', '信用卡', 'SSN', 'IBAN', '銀行帳號', '案號', '通報編號', '病歷號', '公文文號', '安置編號', '車牌']],
  ['sensitive', ['健康資訊', '保護資訊', '經濟資訊']],
  ['place', ['地址', '村里', '機構', '學校', '醫院', '地點', '公司']],
  ['time', ['日期', '生日', '年齡', '金額', '職業']],
];
const BY_CATEGORY = new Map(TONES.flatMap(([tone, names]) => names.map(name => [name, tone] as const)));

export function toneOf(f: Pick<WelfareFinding, 'category' | 'source' | 'personId'>): Tone {
  if (f.source === 'person' || f.personId) return 'person';
  return BY_CATEGORY.get(f.category) ?? (PERSON_ROLES.some(role => f.category.startsWith(role)) ? 'person' : 'other');
}

export const TONE_LABELS: Record<Tone, string> = {
  person: '人物', contact: '聯絡方式', id: '證號與編號', sensitive: '健康・保護・經濟', place: '地點與機構', time: '日期・年齡・金額', other: '其他',
};
