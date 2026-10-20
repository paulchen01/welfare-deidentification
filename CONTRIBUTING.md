# 協作修改

公開專案：[paulchen01/welfare-deidentification](https://github.com/paulchen01/welfare-deidentification)。可直接讀取與 clone；推送與合併仍需要擁有者或獲授權帳號。

在其他電腦使用 Git 與 Node.js 24，執行：

```sh
git clone https://github.com/paulchen01/welfare-deidentification.git
cd welfare-deidentification
npm ci
git switch -c codex/my-change
npm run dev
```

修改後執行 `npm test`、`npm run build`。有寫入權限時，提交並推送功能分支後開 Pull Request；其他協作者可從 fork 提交 PR。合併及直接推送需要授權。合併後 GitHub Actions 自動測試、建置、部署，狀態見 Actions。

## Claude 與其他 AI

- **本機工具**：讓 Claude Code、Codex 或其他編輯器開啟 clone 後的專案資料夾。Claude 的入口是 `CLAUDE.md`，共用規則在 `AGENTS.md`。
- **雲端工具**：支援讀取 GitHub 的工具可使用公開網址；若要推送修改或操作 PR，仍需在該服務完成 GitHub 連線及授權。本次未替任何新的第三方服務開通寫入權限。
- **共用上下文**：README、AGENTS、CONTRIBUTING 與 docs/progress 記錄用途、規則及進度。不要傳送真實個案或還原對照給協作 AI。

Claude 的專案指引與檔案匯入方式依 [官方文件](https://code.claude.com/docs/en/memory) 設定。

## 給其他 AI 的交接文字

> 請協作修改公開專案 https://github.com/paulchen01/welfare-deidentification 。先讀 AGENTS.md、CLAUDE.md、README.md、CONTRIBUTING.md、docs/DEPLOYMENT.md，再檢查目前分支與差異。需求是：【填入這次要改的功能】。請保留本機處理、人工覆核、分享與加密對照分離、DOCX/XLSX 保守結構檢查。使用虛構測試資料，開功能分支，完成相關測試、完整測試及建置後提供 PR 與驗證結果。未獲授權前不要直接推送 main。

## 回報問題

社工可在試用頁下載回饋文字檔並交回邀請者，不需要 GitHub 帳號。也可使用公開專案的「社工試用回饋」issue 範本；不要附真實個案、還原對照或含個資畫面。
