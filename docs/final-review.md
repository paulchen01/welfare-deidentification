# Final independent whole-branch review

Date: 2026-10-18. Initial review covered base `da6b633dfbdb0f31cdc7aecbfe41b657a3622e9e` through head `67b7bdfce2f7d13a172c72bf348b81c7d0e610f7`. Final re-review includes fixes through `bdedf0f34962dba552e86bf8dbf9e26bc9bb02ff`, plus the working-tree fresh-staging update to `scripts/package-local.mjs` and `scripts/verify-package.mjs`.

**Final verdict: Approved. No remaining Critical or Important finding in the reviewed changes.** All three initial findings below are resolved. Independent final focused verification passed **74/74 tests across 3 files**. Final full-suite, build, browser, and packaged-artifact verification remain separately recorded by the implementer; this code review does not substitute for those checks or practical user trials.

## Scope and evidence

Read the approved implementation plan, design proposal, earlier task reviews, application entry point, all `src/welfare` workflow modules, Office safety/parser/generator paths, relevant PDF/OCR changes, local server, package builder, and their focused tests. Independently exercised the three scenarios below through the actual TypeScript modules in Node with a jsdom DOM; no source or dependency changes were made. The only review write is this report.

The reported 477-test full suite, build, real-browser OCR/native-file readbacks, and portable-package checks belong to the implementer's verification; this reviewer did not rerun that entire suite or claim mobile visual verification.

## Strengths

- Export checks both finding-level and whole-document review, uses neutral filenames, and separates share documents from authenticated encrypted recovery data.
- Exact recovery validates the exported text hash and per-occurrence markers, preserving distinct original aliases without pretending AI-rewritten text is an exact match.
- Native Office export reparses bounded fresh ZIP snapshots and checks output remnants; unsupported structures fall back to explicitly reviewed text.
- The local server binds only to loopback, validates Host, accepts GET/HEAD only, and supplies a restrictive CSP. Updated packaging uses fresh staging to avoid stale files.

## Initial findings (all subsequently resolved)

No Critical issue was identified. The initial review identified three Important issues requiring fixes before acceptance.

### Important 1: Excel non-cell text can survive approved native export

Location: `src/welfare/document-safety.ts:210` (XLSX inspection) and `src/welfare/document-safety.ts:313` (XLSX sanitization).

Excel inspection blocks selected known structures but does not validate or neutralize text-bearing attributes such as `xl/styles.xml` `cellStyle/@name`. The sanitizer only renames worksheet names for XLSX. These attributes never appear in the review text, so checking only selected visible original values cannot catch them.

Reproduced with an otherwise supported text workbook containing the cell text `一般服務紀錄` and a custom cell style named `陳隱名專用`. `parseSafeDocument` returned `nativeAllowed: true`; `generateSafeDocument` succeeded; reopening the generated ZIP found `陳隱名專用` unchanged in `xl/styles.xml`. This bypasses the stated structural-coverage boundary even after complete visible-text review.

Fix: neutralize known non-content names and reject unsupported text-bearing spreadsheet nodes/attributes, with the same conservative coverage principle used for Word. Include a regression where the secret exists only in metadata, so visible-value remnant checks cannot hide the defect.

### Important 2: Removing a candidate also removes another case's person and aliases

Location: `src/welfare/views-input.ts:95`; originating IDs at `src/welfare/engine.ts:33` and `:36`, stored by `src/welfare/session.ts:27`.

`proposePeople` restarts IDs at `candidate-1` per document. The remove handler filters the entire session by `id`, although those IDs are only unique within a group. Removing one candidate therefore deletes matching-index candidates from unrelated documents.

Reproduced by adding document 1 `案主：王小明。` and document 2 `案主：陳美惠。暱名小惠來訪。`, confirming document 2's person with alias `小惠`, then clicking remove for document 1's person. Both people disappeared, and reanalysis of document 2 no longer detected `小惠`. Review is invalidated, but the user's confirmed cross-document work and alias protection are silently lost.

Fix: assign globally unique session IDs at insertion and scope removal to the selected person/group. Add a UI regression preserving another independent document's confirmed person, aliases, and findings after removal.

### Important 3: An older cancelled import can disable cancellation of a newer import

Location: `src/welfare/app.ts:41` (`abort=undefined`) together with `:23` (clear) and `:39` (adding parsed documents).

The shared abort controller is cleared unconditionally when any `addFiles` call finishes. An older cancelled call can finish after a new run has assigned a new controller, erase that reference, and prevent a subsequent clear from aborting the new run. The existing generation check only guards `run`'s catch/finally; it does not guard the mutations inside `addFiles`.

Reproduced with controlled delayed `File.text()` promises: start A; clear; start B; resolve A; clear B; resolve B. Immediately after the second clear, there are zero documents. After B completes, `session.documents` again contains `應已清除的個案內容` and the internal view changes to `people`. The current DOM stays on the cleared screen until another render, making the retained data less apparent.

Fix: clear the controller only in a current-run/current-controller guarded completion path, and prevent stale-generation work from mutating the session. Add a regression covering overlapping cancelled A and B with late completion.

## Initial assessment

**Ready to accept: No, pending the three fixes and focused regression checks.** The overall local-first and export-isolation design is sound, but hidden spreadsheet content and cross-run/cross-case state defects affect the core privacy guarantees. The implementer has accepted the findings; this document records the initial independent result and will be supplemented after re-review.

## Re-review

Commit `3667d93cd9fd0b07dbc154db41e2f6a2a5b9c0f4` resolves findings 2 and 3: candidates get unique session IDs, removal also checks the group, and only the current generation can release the active abort controller. Independent execution of `tests/welfare/ui.test.ts` and `tests/welfare/session.test.ts` passed **13/13 tests across 2 files**.

Commit `b62d6a5c89a5a89a331e7bee9923f26b3a49c4fc` addresses the original finding 1 style-name reproduction through style attribute validation and neutralization, with related font/theme/program-name coverage. Re-review identified one remaining instance of the same finding: `customWorkbookView/@name` in `xl/workbook.xml`. A workbook with visible text `一般服務紀錄` and a custom workbook view named `陳隱名檢視` still returned `nativeAllowed: true` and retained that name after native export. The existing inspection blocked `customSheetViews`, but did not block the analogous `customWorkbookViews` / `customWorkbookView` elements. This was returned for a conservative block and regression test.

Also read the new `scripts/verify-package.mjs`: it checks ZIP CRC, extraction paths, all recorded hashes, required documentation/licenses, and starts the extracted bundled Node runtime to verify assets and rejected POST requests. No blocking code issue identified in that verification script. Its actual execution results remain separate evidence from this review.

Commit `bdedf0f34962dba552e86bf8dbf9e26bc9bb02ff` resolves the remaining instance of finding 1. Workbook, worksheet, shared-string, style, and theme content now pass explicit allowed-node/attribute checks; custom workbook views, unknown structures/attributes, and unknown namespace declarations are blocked. Known names are neutralized in fresh output copies; the original source remains unchanged, and rejected native formats retain the reviewed-text fallback. New negative regressions include the exact custom-workbook-view reproduction. A positive workbook-view/layout test verifies the fix does not simply reject every spreadsheet.

Final independent command at the pinned commit:

```text
node --no-experimental-webstorage node_modules/vitest/vitest.mjs run tests/welfare/document-safety.test.ts tests/welfare/ui.test.ts tests/welfare/session.test.ts
```

Result: **3 test files passed, 74 tests passed, exit code 0** (2026-10-18 19:28 Asia/Taipei). Read the complete fix diffs, including added regression and ordinary-layout cases. **Spec compliance: Pass. Task quality: Approved.** No remaining review blocker; no additional source changes are requested by this review.

Count cross-check at the same unchanged `bdedf0f` source/test revision, 19:30 Asia/Taipei: the exact three-file command with `--reporter=verbose` again passed **74/74**. Breakdown: `document-safety.test.ts` **61**, `ui.test.ts` **7**, `session.test.ts` **6**. The implementer's **72 safety tests** count also includes `mixed-pdf.test.ts` (**11**), which was not part of this reviewer's three-file command. These are different test selections, not conflicting results. Intermediate counting probes hit a sandbox temporary-file `EPERM` before running tests; the final permitted rerun completed with exit code 0.
