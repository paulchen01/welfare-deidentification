import type { DocumentKind, Purpose } from './types';
export const PURPOSES: { id: Purpose; label: string; description: string }[] = [
  { id: 'internal', label: '機構內部討論', description: '服務對象直接識別資訊遮蔽；經確認的社工姓名、一般日期可保留，仍須人工覆核。' },
  { id: 'ai', label: '外部 AI 協作', description: '服務對象個資遮蔽；一般服務日期與已確認的工作人員姓名建議保留，仍須覆核。' },
  { id: 'public', label: '公開分享', description: '日期提供年月旬序，年齡與金額提供概化建議；仍需人工覆核。' },
];
export const DOCUMENT_KINDS: { id: DocumentKind; label: string }[] = [
  { id: 'record', label: '個案紀錄' }, { id: 'meeting', label: '會議紀錄' }, { id: 'roster', label: '服務名冊' },
];
export const PERSON_ROLES: string[] = ['服務對象', '父親', '母親', '子女', '手足', '配偶', '主要照顧者', '監護人', '社工', '督導', '通報人', '家屬', '其他人物', '待確認'];
