# Task 1 — 社福規則與人物核心

在本目錄新建福利版核心，供新介面與格式層呼叫。工作目錄 `E:/CodexStorage/Projects/New project 2/welfare-deidentification`。只修改本任務列出的檔案；父代理正在製作介面與輸出，不要改 `src/core/`、`src/formats/`、`src/ui/`、`src/main.ts` 或 package 設定。

## 檔案與固定介面

建立 `src/welfare/types.ts`、`policies.ts`、`engine.ts`、`samples.ts`、`tests/welfare/engine.test.ts` 及必要的 domain 測試。可增加 `rules.ts`、`fixtures.ts` 分拆責任。

```ts
export type Purpose = 'internal' | 'ai' | 'public';
export type DocumentKind = 'record' | 'meeting' | 'roster';
export type FindingAction = 'mask' | 'generalize' | 'keep';
export interface Person {
  id: string; groupId: string; name: string; aliases: string[];
  role: string; confirmed: boolean;
}
export interface InstitutionRule {
  id: string; label: string; prefix: string; minDigits: number; maxDigits: number;
}
export interface DetectionConfig {
  purpose: Purpose; groupId: string; people: Person[];
  customRules?: InstitutionRule[];
}
export interface WelfareFinding {
  id: string; start: number; end: number; original: string; category: string;
  source: 'rule' | 'person' | 'manual' | 'field';
  action: FindingAction; replacement: string; reviewed: boolean;
  personId?: string; message?: string;
  // Optional allowed generalisation text for UI action switch.
  generalized?: string;
}
export interface WelfareSample {
  id: string; title: string; domain: string; text: string;
  people: Person[]; expectedSensitive: string[];
}
```

`engine.ts` exports:

```ts
export function detectWelfare(text: string, config: DetectionConfig): WelfareFinding[];
export function proposePeople(text: string, groupId: string): Person[];
export function createManualFinding(text: string, start: number, end: number,
  category: string, existing: WelfareFinding[]): WelfareFinding;
export function findingsToEdits(text: string, findings: WelfareFinding[]): import('../core/types').TextEdit[];
export function renderText(text: string, findings: WelfareFinding[]): string;
```

`policies.ts` exports `PURPOSES: {id:Purpose;label:string;description:string}[]`, `DOCUMENT_KINDS: {id:DocumentKind;label:string}[]`, `PERSON_ROLES: string[]`.
`samples.ts` exports `WELFARE_SAMPLES: WelfareSample[]` (at least 60; six service domains).

## Required behavior

1. Reuse original `detect` and `BUILTIN_PATTERNS` when helpful, but disable generic guessed Chinese names by default. All direct identifiers full mask, no retained surname/digits. Add social welfare labels and rules: names/roles, case/report/medical/document/placement IDs, labeled bank account/ARC, institutions, schools/hospitals, dates, ages, named village/neighbourhood, labeled occupation and high-risk clinical/protective/economic passages. Be explicit rules are suggestions, no zero-leak promise.
2. Labeled candidate names can be proposed (unconfirmed), but only confirmed people in matching groupId receive role-based identity labels. Candidate guesses must not invent role relationships. Unconfirmed names still receive generic name masking when detected; findings require review.
3. Confirmed canonical name and aliases map to the same readable marker `[服務對象A]`, `[母親A]`, etc; distinct people with same role get distinct suffixes. Same string assigned to >1 confirmed person in the same group must be marked ambiguous/generic, never silently merged. Foreign/multi-character names from explicit people supported. Different groupId isolated.
4. Regex suggestions for person fields include 案主/服務對象/個案姓名/案父/案母/主要照顧者/監護人/社工/督導/通報人. Linking nickname requires explicit alias entry; proposePeople may suggest nickname but keep unconfirmed. No unbounded regular expression accepted from template input.
5. Internal purpose keeps necessary sensitive contexts but emits unreviewed findings. External AI/public purpose masks or suggests generalization. Public dates retain sequence-compatible year/month and early/middle/late month if used; ages use sensible age bands; money ranges only as suggestions. Do not rewrite unselected narrative. Keep/mask/generalize is per finding; `generalized` only for semantically justified suggestions, no invented substitute facts.
6. Findings sorted, no overlapping active spans. Direct identifiers win over incidental contexts. apply functions reject stale offsets, overlaps, invalid replacement bracket controls and out-of-range selections rather than corrupt text. `keep` does not edit. `mask` uses replacement; `generalize` uses generalized (reject when absent). createManualFinding reviewed=true and rejects overlapping existing spans; root handles user selecting category and all-occurrence option.
7. Stable behavior within identical call inputs. No browser persistence, no fetch, no logging original values. Reject unsupported/oversized template prefixes and digit limits. Generalize marker vs reversible marker separate; UI will use occurrence maps for strict roundtrip.
8. Provide ≥60 synthetic records across family, child, elderly, disability, mental health, protection domains (10 per domain) with explicit sensitive-value expected annotations. Include variation in names, dates, phone formatting, case IDs and roles; disclose templated corpus in report. Do not call automatically generated annotations an independent human dataset. Include separately handwritten adversarial test cases for false positives, ambiguous aliases, foreign names, same-name groups, identity IDs, phone/email, preserved substantive prose.

## Tests and delivery

Read test-driven-development skill and write tests first; show RED before implementation and GREEN afterwards. `npm test -- tests/welfare/engine.test.ts` (on Windows npm.cmd). Dependencies are being installed by parent; ask parent if unavailable. Run focused tests, then report full suite expectations without repeatedly running unrelated suites. Use meaningful tests that catch data leaks and identity mistakes, not snapshots of implementation. Do not weaken existing tests to get green.

Write detailed report with tests/RED/GREEN, files, limitations and unresolved concerns to `docs/task-1-report.md`. Commit only your owned files after verification; do not stage parent edits. Return concise status and commit SHA. Do not spawn additional subagents.
