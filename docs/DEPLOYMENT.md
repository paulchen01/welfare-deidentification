# GitHub Pages 部署

- 正式網址：<https://paulchen01.github.io/welfare-deidentification/>
- 社工試用頁：<https://paulchen01.github.io/welfare-deidentification/trial.html>
- 原始碼：<https://github.com/paulchen01/welfare-deidentification>
- 發布分支：`main`。網站由 `.github/workflows/pages.yml` 建置，不手動編輯產生的檔案。

依使用者最新要求，GitHub 儲存庫已恢復 **PUBLIC**，可供 Claude 與其他 AI 讀取、clone 及協作。社工試用網站公開，推送及合併仍需授權。儲存庫曾短暫改為私人；目前 GitHub 方案不支援此私人儲存庫的 Pages，已在恢復公開後重新啟用 GitHub Actions 發布。

2026-10-20 已完成首次公開部署與正式站驗收，結果見 [上線驗收紀錄](launch-verification.md)。

GitHub repository Settings → Pages → Source 使用 **GitHub Actions**。每次 main 推送或手動執行 workflow 會先跑測試，再建置與部署；Pull Request 只驗證，不部署。部署完成以 Actions 成功、線上頁面及檔案實測為準，推送成功本身不等於上線。

建置設定 `VITE_BASE_PATH=/welfare-deidentification/`，保留 GitHub 專案子路徑；未設定時使用相對路徑，供本機離線包使用。`scripts/prepare-pages.mjs` 只公開列入清單的靜態資源，不包含 artifacts、歷史範例、原始個案或加密對照。OCR、PDF worker、語言模型及中文字型均從同一網站載入。

GitHub Pages 提供 HTTPS 靜態網站，沒有本專案的資料接收端。瀏覽器會下載網站資源，GitHub 可能記錄一般連線資訊；選取的個案檔案不傳送到網站。網站沒有登入、追蹤分析或自動回傳回饋。試用回饋表只下載本機文字檔。

頁面使用 CSP meta 限制程式與連線來源。GitHub Pages 不支援本專案自訂 HTTP response headers，故與離線伺服器的 header 層防護不同；meta 無法提供 `frame-ancestors` 防嵌入政策。若機構要求額外標頭、嚴格網路隔離或存取管制，使用自管 HTTPS 主機或離線包。

## 驗證與回復

1. 在 Actions 確認目前 main SHA 的部署成功。
2. 開啟網站與試用頁；用兩份虛構樣本完成上傳、人物確認、全文覆核及 DOCX/PDF 下載。
3. 開啟 `verification.html` 執行瀏覽器驗收；檢查 OCR 字型資源未離開網站來源。
4. 發現問題時，先在分支修正並開 PR；需回復版本可用 `git revert <commit>` 建立可追蹤的回復提交，通過檢查後合併 main 重新部署。不要 force-push 改寫公開歷史。

這個儲存庫不需要部署密碼或 API key；Actions 使用短期 GitHub token 與 Pages OIDC。不要提交 `.env` 或外部發布憑證。
