# Task 2：文件結構檢查與安全輸出

狀態：實作與模組／原格式回歸測試通過。瀏覽器實際逐頁 OCR 與 UI 驗收由父代理執行，本文不將單元測試替代為瀏覽器驗證。

## 變更範圍

- `src/welfare/document-safety.ts`：固定介面 `parseSafeDocument`、`inspectDocument`、`generateSafeDocument`。
- `src/formats/pdf.ts`：選用的 `perPageOcr`，保留原有呼叫者行為。
- `src/formats/ocr.ts`：選用的 `pageNumbers`、原頁碼進度、依選取頁數計算完成比例。
- `tests/welfare/document-safety.test.ts`、`tests/welfare/mixed-pdf.test.ts`。

未增加依賴；未修改 main、engine、types、export、vault、session、CSS、package 或設定檔。

## 驗證記錄

所有 Vitest 命令使用已核准的執行方式：

```text
node --no-experimental-webstorage node_modules/vitest/vitest.mjs run ...
```

1. 初次新增文件安全測試後執行：模組尚不存在，import resolution 失敗；這是介面缺失檢查，不能單獨視為結構行為的 RED 證據。
2. `tests/welfare/mixed-pdf.test.ts tests/welfare/document-safety.test.ts`：25 項中 2 項失敗，證實原 PDF parser 沒有辨識混合文件的無文字頁，也沒有拒絕缺少 OCR 頁面結果。實作後 25/25 通過。
3. `tests/welfare/document-safety.test.ts`：新增 pretty-print XML 跨 run／實體字元殘值、XML 註解、Excel 列印頁首測試，23 項中 3 項確實失敗。修正後安全測試 28/28 通過。
4. 新增多段落殘值、失效共用字串索引、自訂編號文字測試，28 項中 3 項確實失敗。修正後安全測試 35/35 通過。
5. 最終加入 ZIP 項目數／總解壓大小、未引用工作表、不支援 XML namespace、原始格式／大小限制覆蓋；安全測試合計 38 項。
6. 最終相關格式回歸命令：

```text
node --no-experimental-webstorage node_modules/vitest/vitest.mjs run tests/welfare/document-safety.test.ts tests/welfare/mixed-pdf.test.ts tests/integration/roundtrip-docx.test.ts tests/integration/roundtrip-xlsx.test.ts tests/integration/roundtrip-pdf.test.ts tests/unit/ocr-items.test.ts tests/unit/ocr-image.test.ts
```

結果：**7 files、77 tests 通過**，exit 0，2.49 秒（2026-10-18 17:15:21，執行環境當地時間）。

```text
node --no-experimental-webstorage node_modules/vitest/vitest.mjs run tests/integration/roundtrip-ocr.test.ts
```

結果：**1 file、6 tests 通過**，exit 0，11.34 秒。使用真正本機 Tesseract 與既有掃描樣本；stderr 有既有 traineddata 亂碼語言載入警告、resolution／diacritics 訊息。沒有因警告而宣稱輸出乾淨，也沒有改動既有測試降低門檻。

```text
node node_modules/typescript/bin/tsc --noEmit
```

結果：exit 0。

## 支援與省略矩陣

| 結構 | 預覽／文字 | 安全原格式輸出 |
|---|---|---|
| Word 一般段落、表格、可擷取的 header/footer、跨 run 文字 | 沿用既有 parser／offset | 允許；依文字替換，保留支援的樣式與表格 |
| Word 修訂／刪除／移動、註解、註腳／章節附註 | 既有 parser 能讀的部分仍可核對；明示特殊區域未完整擷取 | 阻擋，不默默刪除特殊內容 |
| Word 文字方塊、Fallback／AlternateContent、欄位指令、繪圖、物件、內容控制／資料繫結、隱藏樣式、合併列印 | 明示涵蓋不足 | 阻擋 |
| Word 非正文文字／自訂編號文字 | 未納入一般文字偵測的內容明示阻擋 | 阻擋 |
| Excel 文字型共用字串／inline string／rich text | 沿用儲存格 layout／offset | 允許；處理文字、清除未再引用的共用字串；工作表名稱改為 `中性工作表1` 起的序號 |
| Excel 數值、布林、字串結果型／公式儲存格、公式快取值 | 明示這些值未完整納入文字偵測，數值電話／證號也可能省略 | 阻擋，避免公式或快取值偷渡 |
| Excel 隱藏工作表／列／欄、未引用的額外 worksheet、失效共用字串索引 | 可讀文字仍可核對；報告明示隱藏／不完整 | 阻擋 |
| Excel defined names／資料參照、自訂數字格式、注音、資料驗證、條件格式、列印頁首頁尾等擴充 | 明示未完整擷取 | 阻擋；避免更名工作表破壞參照 |
| Word／Excel 圖片、drawings、embedded files、custom XML、簽章、未知 ZIP parts／relations、外部連結／hyperlink、XML 註解／處理指令 | 不把這些項目說成已掃描完成 | 阻擋；不保留照片再標示成功 |
| docProps 的 core／app／custom、author／initials／userName／rsid、ZIP comments | 不在錯誤／report 顯示來源值 | 刪除屬性檔及對應 content type／relationship、清除作者屬性與 comments |
| PDF 有文字層頁 | 依頁碼擷取、保留座標與 offset | 依文字重建；所有 PDF 均要求核對未擷取的視覺內容 |
| PDF 混合文字與掃描頁 | 只對無文字頁呼叫 OCR，按原頁序合併；onProgress／signal 傳遞 | 文字重建；所有圖片預設 keep=false，輸出時再強制排除圖片 |
| PDF 無法辨識／空白頁 | 保留頁面數與空頁位置，標示不完整 | 阻擋；缺少 OCR 頁面結果則直接拒絕解析 |
| TXT／Markdown | 沿用既有文字 parser | 文字輸出；相同原值殘留檢查 |

## 安全界線

- 仍遵循原 `validateFile` 的 100 MB／格式限制；ZIP 在 JSZip 解壓前檢查 central directory，並再以串流實際位元組計數。上限：**2048 entries、單一項目 8 MiB、合計 32 MiB**。拒絕多磁碟、加密、ZIP64 大值、重複／不安全路徑、損壞結構。錯誤不包含來源檔名、part 路徑、作者、URL、工作表名稱或儲存格內容。
- `generateSafeDocument` 重新檢查現有 handle，忽略呼叫端傳入報告的放行旗標。偽造 `nativeAllowed: true` 無法跳過結構阻擋。
- 原格式生成在重新封裝並重新解析的獨立 ZIP 上進行；DOCX 與 XLSX 都有重複匯出／來源不污染測試。
- 生成後掃描所有 XML 的已解碼文字／屬性、段落與字串中跨 run 的文字，並重新解析語意文字以涵蓋換行／儲存格分隔符。任何被選取替換的原值仍精確殘留，均以不含原值的錯誤阻擋。
- 此檢查針對結構涵蓋與已選取的原值；不是保證自動偵測到所有個資。未知複雜結構採保守阻擋，UI 可提供已核對的擷取文字輸出。
- 沒有新增外送、logging 或持久儲存。原 OCR 維持 `cacheMethod: 'none'`，模型、worker 與字型使用本站資產；未把個案文字或影像送到外部服務。
- 混合 PDF 單元測試使用真 PDF parser，OCR 回傳值以替身控制頁序／空頁；另測真正 `recognizePdf` 的選頁、取消與 worker 結束。真瀏覽器 OCR 選頁辨識品質仍須父代理驗收。
