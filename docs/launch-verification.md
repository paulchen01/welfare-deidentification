# 公開試用版上線驗收（2026-10-20）

首次上線應用程式：`89b57ec292167aa4dbf541adc15d44e2a7cbf956`。使用者已明確授權公開 GitHub 專案及網站發布。這份紀錄補充 10 月 18 日的本機版驗收，不取代其歷史紀錄。

## 交付位置

- [正式工作台](https://paulchen01.github.io/welfare-deidentification/)
- [社工試用頁](https://paulchen01.github.io/welfare-deidentification/trial.html)
- [公開原始碼](https://github.com/paulchen01/welfare-deidentification)
- [首次成功部署紀錄](https://github.com/paulchen01/welfare-deidentification/actions/runs/39451042277)

## 驗證結果

| 項目 | 結果與證據 |
| --- | --- |
| 本機完整測試 | 41 個檔案、501／501 通過；23:41:46 Asia/Taipei 開始 |
| 遠端 CI | Ubuntu／Node 24；501／501 通過，建置及 Pages 部署 success |
| 靜態建置 | TypeScript、Vite、授權收集成功；使用專案子路徑 |
| 正式站瀏覽器驗收 | 23:45:38–23:45:44，11／11 通過 |
| 正式站資源比對 | 23:49:38，11／11 回應 200 且內容與審查後建置一致 |
| 執行依賴稽核 | `npm audit --omit=dev`：0 vulnerabilities |
| 獨立程式審查 | 初次發現 Markdown 誤標與網站缺授權文件，均修正，複審通過 |
| 授權交付 | 35 份授權／聲明及 HTML／JSON 索引隨網站提供；包含原作者 MIT、NOTICE、Noto 字型 OFL |

11 項瀏覽器驗收含：60 份合成資料、分享包與對照隔離、加密還原、Word 輸出與回讀、Word 批註阻擋、Excel 輸出與數值限制、混合 PDF 逐頁 OCR、兩份試用文件的原格式輸出與回讀、設定／儲存檢查、資源來源檢查。當次 19 筆頁面資源與 3 次 fetch 均使用本網站來源；CSP 違規為 0。工作台與試用頁主控台 error/warn 為空。

## 實際介面下載

在正式網址透過檔案選擇器分別載入虛構 Word、PDF，確認兩位人物角色，完成 5 項及全文覆核，選擇原格式後點選「下載這份文件」。不是只呼叫底層輸出函式。

- **DOCX**：實際下載 `文件-001.docx`，2,237 bytes。逐項檢查 ZIP 中 XML／relationships，兩個原姓名及電話均無殘留，角色標記與服務敘事仍在。SHA-256：`d117d52dd84f3f99b9a16493d6deea7591dc7bd3f91f684d572b752b909802a1`。
- **PDF**：實際下載 `文件-001.pdf`，200,759 bytes、1 頁。獨立解析回讀確認兩個原姓名及電話均無殘留，角色標記與服務敘事仍在；另外渲染第一頁檢查中文字、遮罩與版面。SHA-256：`bad44c2e6378626b5903519d00948c386d3f70c78c6d6f33f284313e34195e96`。
- **回饋文字檔**：在正式試用頁填入明示為自動化驗收的內容，實際下載並回讀成功。此表沒有自動送出、寄信或建立 issue。

本機驗收附件位於 `artifacts/production-*`，不提交到公開 Git。網站入口 SHA-256：`bfb746b89f60d7d35ecdfb604db55341b37f23b61f31b78bef7cadc8d748c653`。

## 試用與限制

可將試用頁分享給 3–5 位社工，先使用內附虛構樣本完成三項任務，下載回饋檔後交回邀請者。GitHub issue 是公開的，只能附虛構範例。尚未邀請或代替真實社工完成實務試用，也未以真實個案驗證辨識率。

PDF 輸出為重建文字版，圖片不保留；複雜 Word／Excel 可能因結構檢查而只能輸出已抽取文字。規則與 OCR 均需人工覆核，不保證完全匿名。此次未宣稱手機實機、作業系統封包擷取或實體斷網驗證。Node 測試仍有既存 Tesseract 語言資料警告，正式瀏覽器 OCR 驗收通過；PDF bundle 大小警告仍在。

main 的後續提交會自動測試、建置及部署。其他電腦與 AI 的接手步驟見 [CONTRIBUTING.md](../CONTRIBUTING.md)，部署細節見 [DEPLOYMENT.md](DEPLOYMENT.md)。
