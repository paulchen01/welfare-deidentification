# 協作修改

私人專案：[paulchen01/welfare-deidentification](https://github.com/paulchen01/welfare-deidentification)。需要擁有者或獲授權帳號登入才能讀取；儲存庫維持 PRIVATE。

在其他電腦使用 Git 與 Node.js 24，先以有此專案權限的 GitHub 帳號完成 Git 驗證，再執行：

```sh
git clone https://github.com/paulchen01/welfare-deidentification.git
cd welfare-deidentification
npm ci
git switch -c codex/my-change
npm run dev
```

修改後執行 `npm test`、`npm run build`。提交並推送功能分支後開 Pull Request。只有專案擁有者或獲授權協作者能存取、合併／推送；沒有權限時請由擁有者設定，不要改成公開專案。合併後 GitHub Actions 自動測試、建置、部署，狀態見 Actions。

## Claude 與其他 AI

- **本機工具**：讓 Claude Code、Codex 或其他編輯器開啟已授權的專案資料夾。Claude 的入口是 `CLAUDE.md`，共用規則在 `AGENTS.md`；不需要公開 GitHub 儲存庫。
- **雲端工具**：需要由擁有者在該服務的 GitHub 連線中，授權此私人專案。只有提供網址並不會取得權限；本次未替任何新的第三方服務開通存取權。
- **共用上下文**：README、AGENTS、CONTRIBUTING 與 docs/progress 記錄用途、規則及進度。不要傳送真實個案或還原對照給協作 AI。

Claude 的專案指引與檔案匯入方式依 [官方文件](https://code.claude.com/docs/en/memory) 設定。

## 給其他 AI 的交接文字

> 請協作修改私人專案 https://github.com/paulchen01/welfare-deidentification ，保持 PRIVATE，使用已授權的本機資料夾或 GitHub 連線。先讀 AGENTS.md、README.md、CONTRIBUTING.md、docs/DEPLOYMENT.md，再檢查目前分支與差異。需求是：【填入這次要改的功能】。請保留本機處理、人工覆核、分享與加密對照分離、DOCX/XLSX 保守結構檢查。使用虛構測試資料，開功能分支，完成相關測試、完整測試及建置後提供 PR 與驗證結果。未獲授權前不要直接推送 main。

## 回報問題

社工可在試用頁下載回饋文字檔並交回邀請者，不需要 GitHub 權限。獲授權協作者可使用私人專案的「社工試用回饋」issue 範本；即使是私人 issue，也不要附真實個案、還原對照或含個資畫面。
