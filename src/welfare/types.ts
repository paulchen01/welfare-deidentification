export type Purpose = 'internal' | 'ai' | 'public';
export type DocumentKind = 'record' | 'meeting' | 'roster';
export type FindingAction = 'mask' | 'generalize' | 'keep';
export interface Person { id: string; groupId: string; name: string; aliases: string[]; role: string; confirmed: boolean; }
export interface InstitutionRule { id: string; label: string; prefix: string; minDigits: number; maxDigits: number; }
export interface DetectionConfig { purpose: Purpose; groupId: string; people: Person[]; customRules?: InstitutionRule[]; }
export interface WelfareFinding {
  id: string; start: number; end: number; original: string; category: string;
  source: 'rule' | 'person' | 'manual' | 'field'; action: FindingAction; replacement: string;
  reviewed: boolean; personId?: string; message?: string; generalized?: string;
}
export interface WelfareSample { id: string; title: string; domain: string; text: string; people: Person[]; expectedSensitive: string[]; }
