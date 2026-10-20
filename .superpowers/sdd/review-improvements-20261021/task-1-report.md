# Task 1 report: 在地規則與批次人物輸入

- Branch: `codex/review-workflow-improvements`
- Starting commit: `3d30cb4` (approved plan); application baseline `0d85be6`.
- Scope completed: label-scoped 車牌、LINE ID、統編 rules; conservative ambiguous identity linking; transactional bulk person preview/import UI; focused regression tests.
- No new dependencies, network calls, persistence, deployment, worktree, or branch changes.

## Implementation

`src/welfare/local-identifiers.ts`

- Reads whole field tokens after explicit 車牌／車號、LINE ID／LINE帳號、統一編號／統編 labels with colon or horizontal whitespace separator.
- Uses label boundaries so `BASELINE ID` cannot become a LINE ID match.
- Supports common letter/digit hyphen plate orientations, including mixed plate prefixes; preserves original case and explicitly warns this is not complete plate recognition.
- LINE values allow ASCII letters, digits, period, underscore and hyphen; at least one letter/digit, 1–20 characters. Whole tokens are validated, so unsupported suffixes and overlong values do not produce partial LINE matches. Numeric values are allowed only in this explicit label context.
- Eight-digit business numbers use the existing `isValidTaxId` checksum. Failed checks remain unreviewed typo candidates with an explicit warning, never a claim of valid identification.
- Arbitrary codes and unlabeled eight-digit numbers do not trigger these rules.

`src/welfare/engine.ts`

- Integrates the stable categories 車牌、LINE ID、統編 as direct identifiers, masked and unreviewed for all purposes.
- Gives explicit local fields priority 121 over generic account matching (120), so `LINE帳號：12345678` is LINE ID rather than 銀行帳號.
- If a name/alias is owned by multiple people in the same group, it remains `[姓名]` without `personId`, including the case where only one owner is confirmed. Previously, importing an unconfirmed second owner of an already confirmed alias could incorrectly map that text to the confirmed person's identity. Regression covers both owner orderings and other-group isolation. Other identity logic is preserved.

`src/welfare/bulk-people.ts`

- Pure preview accepts one person per line, or three tab-delimited columns: name, existing role or blank, explicit aliases separated by 、 (comma variants also accepted consistently with the current person editor).
- Maximum 100 physical rows; 120 UTF-16 characters for each name/alias, matching the engine's existing bound; maximum 20 explicit alias entries. Exact limit cases pass.
- One final newline terminates the last row; interior blank rows are reported with their actual line number. Empty input, invalid role, extra columns, empty/overlong aliases and control/format characters are errors.
- Same-case exact name duplicates and repeated input names are reported and skipped. Another case's same name is unaffected. Existing aliases and confirmations are not modified.
- All valid additions remain unconfirmed; blank role becomes 待確認. Explicit roles and aliases are never inferred or combined with existing people.
- Import checks the target document/group and case-roster snapshot, then re-parses the complete source. Any invalid row or stale preview prevents all additions.
- Constructs all new entries before mutation. Reanalyses only documents in the affected case, invalidating finding and full-text review. Another case's review state remains unchanged.
- If reanalysis throws, rolls back the original people array and affected document state. This is transaction failure rollback, not the review undo action; no changed roster/output remains accepted.
- Reanalysis continues through `session.reanalyse`, allowing the subsequent review-history task to invalidate history in that central method.

`src/welfare/views-input.ts`

- Adds a Traditional Chinese bulk-person card with copyable synthetic example, format/limits, existing role choices and memory-only lifecycle explanation.
- Preview lists additions with explicit unconfirmed state, duplicate row messages and all errors.
- Import is a separate explicit button; errors disable it and explain there is no partial import.
- Editing the textarea immediately invalidates the preview. UI rerender, navigation, document change and clear discard local draft/preview state. Stale detached handlers also check the active document/group before importing.
- Preserves existing person/editor, other view labels, source text rendering and creator attribution.

## TDD evidence

All commands below ran in this checkout. The first sandbox test attempt could not load suites because Windows temporary-file rename returned EPERM (and the initially absent parser module could not resolve). That launch failure is not counted as RED evidence. Re-running npm test with the permitted escalation and an explicit unimplemented parser skeleton produced real expected feature failures.

1. RED: `npm test -- tests/welfare/local-identifiers.test.ts tests/welfare/bulk-people.test.ts`
   - 2 files failed; 15 failed / 2 passed, 17 tests.
   - Missing local identifier suggestions, confirmed alias incorrectly selected, and parser's explicit unimplemented feature errors.
2. RED: `npm test -- tests/welfare/bulk-people-ui.test.ts`
   - 3 failed / 0 passed: bulk input was absent.
3. GREEN after initial implementation: `npm test -- tests/welfare/local-identifiers.test.ts tests/welfare/bulk-people.test.ts tests/welfare/bulk-people-ui.test.ts tests/welfare/engine.test.ts tests/welfare/ui.test.ts`
   - 5 files passed; 57 tests passed.
4. Added exact-limit/order/group tests plus a transaction-failure regression; RED: `npm test -- tests/welfare/bulk-people.test.ts`
   - 1 failed / 15 passed: reanalysis failure left newly added people behind.
   - Added transaction rollback; focused GREEN: 5 files / 61 tests passed, build passed.
5. Self-review boundary regressions; RED: `npm test -- tests/welfare/local-identifiers.test.ts`
   - 3 failed / 3 passed: BASELINE suffix misidentified, punctuation-only LINE accepted, numeric LINE mislabeled as bank account.
   - Fixed whole label boundary, alphanumeric content check, and specific-label priority.
6. Final focused GREEN (same five-file command above): 5 files / 62 tests passed.

## Final verification

- `npm test`: **44 files passed, 526 tests passed**, exit 0 (baseline 501 plus 25 new tests).
- `npm run build`: TypeScript and Vite production build passed, exit 0; 356 modules transformed; 35 license/notice files included.
- `git diff --check`: exit 0.
- Full test output includes pre-existing Node OCR language/traineddata and resolution/diacritic diagnostics. They did not fail tests. Vite reports the existing large PDF chunk warning; no dependency or bundling changes were made.
- Existing engine and workflow UI test files pass unchanged.
- Self-reviewed scope, input bounds, stale-preview rejection, transactional behavior, group isolation and no-persistence/no-network constraints.

## Files owned by this task

- `src/welfare/engine.ts`
- `src/welfare/local-identifiers.ts` (new)
- `src/welfare/bulk-people.ts` (new)
- `src/welfare/views-input.ts`
- `tests/welfare/local-identifiers.test.ts` (new, 6 tests)
- `tests/welfare/bulk-people.test.ts` (new, 16 tests)
- `tests/welfare/bulk-people-ui.test.ts` (new, 3 tests)
- This report.

## Limits and integration notes

- No blocker identified. Rules remain deliberate label-scoped suggestions, not a complete plate/LINE/identity guarantee or real-world accuracy claim.
- No PDF/Word/OCR/export-format implementation was changed. This task's interface verification uses jsdom; the parent workflow should include bulk preview/import in the combined real-browser acceptance before release.
- Roster changes invoke same-case `session.reanalyse`, so Task 2's central history invalidation is expected to apply. Failure rollback snapshots affected document fields; any future externally stored history should remain safely invalidated rather than regain stale export permission.
- Publication, PR, merge, deployment and overall browser acceptance remain owned by the parent workflow.
