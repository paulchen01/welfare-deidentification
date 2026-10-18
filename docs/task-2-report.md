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

## 獨立 review 必修補正（2026-10-18）

獨立 review 指出的兩項問題確實成立；原先通過 77 項相關測試仍未涵蓋這兩個情境。

1. **未預覽 Word 屬性可能留下個資。** 新增合法書籤名稱、樣式名稱、未知文字屬性／文字節點、已知格式字詞放在錯誤欄位的探針。書籤及未知欄位現在阻擋；樣式名稱／別名、styleId 與所有支援的樣式引用一致中性化；字型名稱與主題標籤亦中性化，並以 info 明示可能改變字型與版面。允許的 Word parts 不再代表其中所有欄位一律安全：Word 節點採明確集合、屬性檢查已知欄位及格式值；非 `w:t` 的未知文字不放行。編號只允許 `%1` 至 `%9` 佔位及分隔標點，固定數字電話也阻擋；表格 caption／description 因未預覽而阻擋。封裝清單／relationship 根節點額外欄位、未知 MIME、未解析關聯也阻擋。docProps 仍整項清除，作者與編輯識別屬性移除。
2. **原始 handle 變動可能套用過期 offset。** Word／Excel 在獨立 ZIP 重新解析後，要求 `fresh.text === doc.text` 才能套用 edits。第一次檢查時另以僅存於記憶體的 WeakMap 綁定覆核文字；同時竄改來源 ZIP 與 `doc.text` 仍拒絕。PDF 檢查每一個 page item、segment 的原文、範圍、頁碼及項目映射，並確保 segment 外只有原有分隔空白；不依賴丟失 `hasEOL` 的重新排版，避免誤擋正常換行。輸出使用複製的 PDF item／segment，圖片仍強制排除。所有變動錯誤使用不含原值的通用訊息，要求重新載入核對。

RED 證據：首次 review regression run **47 tests 中 10 failed、37 passed**，重現樣式殘值、4 種未預覽欄位及 Word／Excel／PDF 可變來源。補查封裝欄位再得到 **2 failed、49 passed**；固定數字編號及錯誤文字欄位位置各有獨立 1 failed 證據。修正後全部轉 GREEN。兩個 public Word 展示檔含原本就應阻擋的頁碼欄位，沒有放寬其安全限制；另以乾淨 `tests/fixtures/sample.docx` 驗證正常 Word 原格式輸出，並測試自訂樣式 ID／引用／字型標籤一致清理。

最終本次命令沿用上方 7-file 相關格式回歸命令，結果 **7 files、94 tests 通過**（安全測試 **55** 項），exit 0，2.62 秒，2026-10-18 17:53:26。`node node_modules/typescript/bin/tsc --noEmit` 亦 exit 0。本次補正未修改 `pdf.ts` 或 `ocr.ts`；真 OCR 的既有 traineddata stderr 警告及前次 6/6 結果仍如上記錄，未將警告抹除或改稱無警告。

相容性界線：不在已知 Word 節點／格式欄位集合中的擴充、複雜主題或自訂設定會保守阻擋，提供核對後擷取文字輸出；不是把未知內容刪掉後標成成功。樣式及字型標籤中性化會改動文件可辨識的中繼名稱與字型選擇，使用者需核對版面。

## 最終 review 補正：Excel 樣式中繼資料（2026-10-18）

最終 review 發現 `xl/styles.xml` 的 `cellStyle/@name` 可含不在儲存格預覽中的人名，原格式仍會保留；此問題確實存在。新增探針同時檢查 cell-style／font 名稱、自訂 tableStyle、自訂 defaultTableStyle、未知 styles 屬性及 numFmt formatCode：RED 結果 **4 failed、1 passed**（另 44 skipped），既有 numFmt 阻擋已有效，其餘漏口重現。

修正後：

- cellStyle 名稱改為不重複的中性樣式序號；Excel font/name、DrawingML 主題名稱與字型名稱中性化。workbook／sheet／fileVersion 的 codeName 清除，fileVersion appName 固定為 `xl`。這些屬性不改動儲存格內容與索引；原始 ZIP 保持不變。
- `xl/styles.xml` 使用明確的節點／屬性與格式值集合，阻擋未知文字欄位／節點；自訂 tableStyle 定義與自訂 defaultTableStyle／defaultPivotStyle 名稱阻擋。標準 TableStyle／PivotStyle 預設名稱可用，並有正常原格式輸出測試。
- numFmt／formatCode 仍全面阻擋；沒有刪除未知顯示格式後宣稱成功。info 明示樣式／字型／主題識別名稱會清理、字型與版面可能改變。所有 report／錯誤仍不顯示來源欄位值。

最終相關回歸命令沿用上述 7-file 命令，**7 files、101 tests 通過**（安全測試 **62** 項），exit 0，3.00 秒（2026-10-18 19:21:28）。`node node_modules/typescript/bin/tsc --noEmit` exit 0。未修改 OCR 檔與原有 OCR 警告處理，也未修改 UI／session 或父代理負責的重複 person ID 功能。

## 最終再覆核：XLSX 以封閉結構檢查取代額外 blocklist

再覆核確認 `customWorkbookViews/customWorkbookView/@name` 仍可能留存未預覽名稱。新增 exact probe，連同未知 workbook root 屬性、worksheet 屬性／結構、shared-string 結構與 theme 屬性，RED 為 **6 failed**。另驗出任意 namespace 宣告也可存入未預覽文字，新增三個 RED；一般 workbook views／worksheet layout 的正向測試已通過。

本次改為所有允許的 XLSX XML parts 都有封閉檢查：workbook、worksheet、shared strings、styles、theme、package manifest／relationships 各用明確節點與逐節點屬性集合；未知節點、未知屬性、未知 namespace、未認可格式值直接阻擋。只有已知 sheet/style/font/theme/codeName/appName 欄位可依前述規則中性化；沒有替未知結構新增支援。`customWorkbookViews`／`customSheetViews` 均不在支援集合內。`t`／`v` 文字節點還須出現在已知儲存格／共用字串結構中，避免同名節點放在未預覽區域。已支援的普通 workbook view、儲存格、rich/inline text、合併範圍及頁面邊界維持可輸出；更複雜或未知擴充依核對文字 fallback 處理。

最終相關 7-file 回歸 **111/111 tests 通過**（安全 **72** 項），exit 0，2.80 秒，2026-10-18 19:27:40。TypeScript `tsc --noEmit` exit 0。只修改 document-safety 模組、其測試與本報告，未修改 UI、session 或封裝程式。
