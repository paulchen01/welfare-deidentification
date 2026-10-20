# 協作修改

公開原始碼：[paulchen01/welfare-deidentification](https://github.com/paulchen01/welfare-deidentification)。

在任何電腦使用 Git 與 Node.js 24：

```sh
git clone https://github.com/paulchen01/welfare-deidentification.git
cd welfare-deidentification
npm ci
git switch -c codex/my-change
npm run dev
```

修改後執行 `npm test`、`npm run build`。提交並推送功能分支後開 Pull Request；無寫入權限的協作者可先 fork。只有專案擁有者或獲授權協作者能合併／推送 main。合併後 GitHub Actions 自動測試、建置、部署，狀態見 Actions。

## 給其他 AI 的交接文字

> 請協作修改 https://github.com/paulchen01/welfare-deidentification 。先讀 AGENTS.md、README.md、CONTRIBUTING.md、docs/DEPLOYMENT.md，再檢查目前分支與差異。需求是：【填入這次要改的功能】。請保留本機處理、人工覆核、分享與加密對照分離、DOCX/XLSX 保守結構檢查。使用虛構測試資料，開功能分支，完成相關測試、完整測試及建置後提供 PR 與驗證結果。未獲授權前不要直接推送 main。

## 回報問題

一般操作問題使用「社工試用回饋」issue 範本。描述瀏覽器、步驟、預期與實際結果。請使用試用頁虛構檔重現；公開 issue 不得附真實個案、還原對照或含個資畫面。疑似資料外洩或安全問題不要公開敏感內容，可先以不含個資的方式聯絡專案擁有者。
