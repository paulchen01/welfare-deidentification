import type { InstitutionRule, Purpose } from './types';

export interface InstitutionProfile { version: 1; name: string; purpose: Purpose; rules: InstitutionRule[] }
export const DEFAULT_PROFILE: InstitutionProfile = {version:1, name:'社福通用設定', purpose:'ai', rules:[]};

export function parseProfile(text: string): InstitutionProfile {
  if (text.length > 50_000) throw new Error('機構範本超過大小上限');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('機構範本格式錯誤'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('機構範本格式錯誤');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !['version','name','purpose','rules'].includes(k))) throw new Error('範本含不支援欄位；不能包含個案原文或人物名單');
  if (v.version !== 1 || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 60 ||
    !['internal','ai','public'].includes(String(v.purpose)) || !Array.isArray(v.rules) || v.rules.length > 30) throw new Error('機構範本設定無效');
  const ids = new Set<string>();
  for (const r of v.rules) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some((k) => !['id','label','prefix','minDigits','maxDigits'].includes(k)) ||
      typeof r.id !== 'string' || !/^[a-zA-Z0-9-]{1,40}$/.test(r.id) || ids.has(r.id) ||
      typeof r.label !== 'string' || !r.label.trim() || r.label.length > 30 || /[\[\]\r\n]/.test(r.label) ||
      typeof r.prefix !== 'string' || !/^[A-Za-z0-9-]{1,20}$/.test(r.prefix) ||
      !Number.isInteger(r.minDigits) || !Number.isInteger(r.maxDigits) || r.minDigits < 2 || r.maxDigits > 20 || r.minDigits > r.maxDigits) {
      throw new Error('個案號規則無效：請填入英數前綴與 2–20 位數字範圍');
    }
    ids.add(r.id);
  }
  return {version:1, name:v.name, purpose:v.purpose as Purpose, rules:v.rules as InstitutionRule[]};
}

export function serializeProfile(profile: InstitutionProfile): string {
  return JSON.stringify(parseProfile(JSON.stringify(profile)), null, 2);
}
