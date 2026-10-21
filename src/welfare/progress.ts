import type { UIContext } from './ui-context';
import type { WorkspaceView } from './session';
import { node, button } from './ui-kit';

export type StepState = 'done' | 'current' | 'todo' | 'locked';
export interface WorkflowStep { id: WorkspaceView; num: string; label: string; state: StepState; detail?: string }

const STEPS: [WorkspaceView, string, string][] = [['input', '01', '加入資料'], ['people', '02', '人物與規則'], ['review', '03', '人工覆核'], ['export', '04', '匯出文件']];

/** Where the person is in the four steps. Display only: export gates are enforced elsewhere. */
export function workflowSteps(ctx: UIContext): WorkflowStep[] {
  const { session } = ctx, docs = session.documents, hasDocs = docs.length > 0;
  const groups = new Set(docs.map(d => d.groupId));
  const unconfirmed = session.people.filter(p => groups.has(p.groupId) && p.name.trim() && !p.confirmed).length;
  const pending = docs.reduce((n, d) => n + d.findings.filter(f => !f.reviewed).length, 0);
  const reviewed = hasDocs && pending === 0 && docs.every(d => d.reviewConfirmed);
  const done: Record<string, boolean> = { input: hasDocs, people: hasDocs && unconfirmed === 0, review: reviewed, export: false };
  const detail: Record<string, string | undefined> = {
    input: hasDocs ? `${docs.length} 份文件` : undefined,
    people: hasDocs && unconfirmed ? `${unconfirmed} 位未確認` : undefined,
    review: hasDocs && !reviewed ? (pending ? `剩 ${pending} 項` : '待讀全文') : undefined,
  };
  return STEPS.map(([id, num, label]) => ({
    id, num, label, detail: detail[id],
    state: ctx.view === id ? 'current' : done[id] ? 'done' : !hasDocs && id !== 'input' ? 'locked' : 'todo',
  }));
}

/** The horizontal progress bar above each workflow page. */
export function stepper(ctx: UIContext): HTMLElement {
  const list = node('ol', 'stepper'); list.setAttribute('aria-label', '工作進度');
  for (const step of workflowSteps(ctx)) {
    const item = node('li', `step ${step.state}`);
    const go = button('', () => ctx.go(step.id), 'step-button'); go.disabled = ctx.busy;
    if (step.state === 'current') go.setAttribute('aria-current', 'step');
    go.setAttribute('aria-label', `${step.num} ${step.label}${step.state === 'done' ? '，已完成' : ''}${step.detail ? `，${step.detail}` : ''}`);
    go.append(node('span', 'step-mark', step.state === 'done' ? '✓' : String(Number(step.num))), node('span', 'step-label', step.label));
    if (step.detail) go.append(node('span', 'step-detail', step.detail));
    item.append(go); list.append(item);
  }
  return list;
}
