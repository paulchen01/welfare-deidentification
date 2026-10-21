# Implementation progress

- Approved: user "我同意" on 2026-10-18.
- Task 1 complete: social-welfare rules, purposes, confirmed roles/aliases and 60 synthetic cases; independent review passed.
- Task 2 complete: conservative Office structure gates, clean export copies, per-page PDF/OCR and source identity checks; final corrections through bdedf0f independently approved.
- UI/export/vault/profile complete: review gates, separate encrypted recovery, neutral sharing, case isolation and cancellation regressions.
- Final application verification: 497/497 tests in 41 files, production build, browser 9/9 and HTTP 5/5 passed.
- Portable package: built, extracted, all file hashes verified and bundled runtime started; 4/4 checks passed. Final artifact evidence is artifacts/package-verification.json.
- Independent whole-branch review: approved after all three Important findings were fixed; see docs/final-review.md.
- Delivery: local preview, Windows portable ZIP, source, usage instructions and pilot checklist.
- Public launch complete on 2026-10-20: public GitHub repository, Pages HTTPS site, main CI deployment, contributor/AI instructions, trial page, fictional Word/PDF downloads and local feedback form. See docs/launch-verification.md.
- Launch verification: 501/501 local and remote CI tests, production browser 11/11, HTTP/build comparison 11/11; real UI DOCX/PDF downloads independently reread.
- Latest user direction (2026-10-21): restored PUBLIC after a brief private interval; re-enabled GitHub Pages because the current plan did not support Pages for this private repository. Added CLAUDE.md and public collaboration guidance. Sidebar producer credit: 飽螺的社工甘苦便條紙 製作.
- Pending user-arranged scope: practitioner pilot and independent real-world corpus. Physical network-disconnection and narrow-screen visual testing remain unverified.
- 2026-10-21 narrative detection (branch `claude/narrative-detection`): unlabeled names after relationship words and surname + honorific forms as unconfirmed candidates; short-form/nickname masking that never links to a person automatically; place names limited to the proper name (「就讀[機構]」); year-month, month-day and slash dates; Chinese-numeral ages and school grades; common chronic/developmental conditions. UI: role and alias suggestions applied only by button, unconfirmed-person notice, manual-mark category shortcuts, sticky progress bar, two-step batch approval, single rule notice and a 0-risk caveat on export. Verified with synthetic data only; practitioner pilot still pending.
