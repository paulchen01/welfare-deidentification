# Task 2 — 文件結構檢查與安全輸出

工作目錄 `E:/CodexStorage/Projects/New project 2/welfare-deidentification`。新介面採用原版格式處理器，但原格式輸出必須先通過涵蓋檢查。你擁有 `src/welfare/document-safety.ts`、`tests/welfare/document-safety.test.ts`、`tests/welfare/mixed-pdf.test.ts`，以及必要的 `src/formats/pdf.ts` 與 `src/formats/ocr.ts` 修改。不要碰其他代理的 `src/welfare/engine.ts/types.ts/app.ts/export.ts/vault.ts/profile.ts`、main、CSS、package 設定。

## 固定介面

```ts
import type { LoadedDocument, TextEdit } from '../core/types';
import type { ParsePdfOptions } from '../formats/pdf';
export interface SafetyIssue { code:string; severity:'block'|'review'|'info'; message:string }
export interface FormatSafetyReport { nativeAllowed:boolean; issues:SafetyIssue[]; pages?:number }
export async function parseSafeDocument(file:File, options?:ParsePdfOptions):Promise<{document:LoadedDocument; report:FormatSafetyReport}>;
export async function inspectDocument(doc:LoadedDocument):Promise<FormatSafetyReport>;
export async function generateSafeDocument(doc:LoadedDocument, edits:TextEdit[], report:FormatSafetyReport):Promise<Blob>;
```

## Requirements

1. Inspect ZIP parts instead of claiming all DOCX/XLSX parts safe. Identify comments, tracked changes/deleted text, footnotes/endnotes, unsupported text boxes/fallback/instructions, media/drawings/embedded files, custom XML, signatures, external/hyperlink relationships, metadata, hidden sheets/rows/columns, numeric/formula cells, sheet names. Error/report messages NEVER include source text, source filename, actual author names, external URLs, worksheet names, or sensitive values.
2. Safe native export for supported ordinary DOCX and text-oriented XLSX must exist. Clean removable metadata (docProps, author attributes etc) and rename sheet names to 中性工作表1 etc ONLY when no formula or references could break. Strip or block comments, revisions and unsupported parts; no silent deletion of content under a blanket success label. A conservative blocker with specific reason and UI-offered reviewed plain-text fallback is acceptable per approved design. Do not reject all DOCX/XLSX unconditionally.
3. Numeric/formula XLSX: include values in readable text/preview if supported, or flag and block native export with clear omissions. Users need to see why numeric phone/ID and formulas were not processed. Parent UI offers column masking for extracted cells. Formula content/unknown cached values must not sneak into output. Hidden text sheets/rows should either appear for review and be clearly labeled, or block. Default images excluded or block, never keep a photo silently.
4. `generateSafeDocument` MUST re-inspect doc (do not trust passed nativeAllowed) and reject blocked native export. Work on a fresh ZIP clone so repeat export doesn't mutate originals/source or previous results. Sanitize allowlisted harmless metadata and reject known hidden payloads. Scan output parts for exact original values from edits after generation (entity-decode XML/concatenate runs where appropriate); if any selected sensitive original remains, throw generic error.
5. `parseSafeDocument` enforces original validateFile size/format, gives report for original docx/xlsx, and handles PDF per page. Original parsePdf only OCRs when whole file has no text. Add safe per-page support: OCR each page lacking text while preserving original page order/layout and offsets; mixed text/image pages with uncertain unextracted visuals must be flagged for review and export only reconstructed recognized text (no original images). Empty/unreadable page must raise blocking/incomplete flag, not claim completed. Avoid silently dropping pages. Original OCR helper can be extended with page selection if needed; keep upstream callers/tests working.
6. PDF images should default keep=false in this new workflow even if upstream parser keeps images. UI says images omitted; no automatic image-retention promises. OCR onProgress/cancel upstream options remain working. Need live browser OCR QA by parent; module tests should cover page-selection/order and output gating meaningfully.
7. No network sending data, logging raw values, or persistence. No new dependencies unless justified to parent. Guard malformed/oversized ZIP structures with limits (e.g. entry count/decompressed XML) to avoid unbounded parsing. File size ceiling 100MB alone not enough; reasonable explicit caps and user-visible errors.

## TDD and handoff

Write failing structural leak tests before implementation (e.g. revision old value, comment/metadata value, numeric phone, hidden sheet, fake passed report). Read helpers in tests/helpers for fixture builders. Cover ordinary clean Word/Excel success, metadata cleaning, blocked native but text accessible, selected sensitive remnants rejected, repeated exports isolation. Run focused tests then relevant original format tests, report counts and output. Tests run with `node --no-experimental-webstorage node_modules/vitest/vitest.mjs run ...`; Windows sandbox may block temp rename, then use require_escalated with a narrow justification (prefix already approved). Vite test config handles Node25 WebStorage.

Write report to `docs/task-2-report.md` with RED/GREEN commands/results, files, exact support/omission matrix and concerns. Commit ONLY owned files. Return status/commit/test summary. Do not spawn agents.
