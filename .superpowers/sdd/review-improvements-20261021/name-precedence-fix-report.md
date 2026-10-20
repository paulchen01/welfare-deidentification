# 人工確認姓名優先修正報告

- 分支：`codex/confirmed-name-precedence`
- 基準：`00ef156`。
- 原反例（合成資料）：原文 `案母：陳美惠陪同會談。`；人物頁將初始長候選改為 `陳美惠`，指定母親並人工確認後，原先仍輸出 `案母：[姓名]。`，連帶遮掉陪同會談敘事。
- 修正後：`案母：[母親A]陪同會談。`。

## 原因與最小變更

`detectWelfare` 在每次偵測時重新呼叫 `proposePeople`，產生只供本次偵測的長候選 `陳美惠陪同會談`。它與人工確認的短姓名同優先權；既有較長範圍優先排序令臨時長候選勝出。這與人物頁內人工修正無關，也不能靠再次確認解決。

只修改 `src/welfare/engine.ts`：

1. 在加入本次臨時 `proposePeople` 候選前，保留目前案件人物清單的姓名／別名字串集合，明確區分來源。
2. 依已產生的姓名候選範圍建立「唯一且已確認人物」的同起點最短結束位置表。使用實際命中範圍，所以沿用英文字母邊界；不是單純字串 startsWith。
3. 在既有重疊處理前，只略過來源為人物、未在人物清單內、同起點且嚴格較長的臨時候選。短姓名需已取得唯一已確認的 `personId` 才能觸發。

不提高所有已確認人物的優先權、不更動 `proposePeople` 的詞典／啟發式、不新增動詞特例、不改人物清單長短姓名排序、不改跨案及共用別名歧義規則。已確認名稱之外的未知人名仍採原來的保守候選處理。機構自訂規則縱使分類命名為「姓名」，也不會被當臨時人物候選略過。

## TDD 證據

測試命令在 Windows 既知暫存 rename EPERM 條件下使用獲允許的 `require_escalated` npm test 範圍；未安裝依賴。

1. 新增 `tests/welfare/name-precedence.test.ts`，先執行：
   `npm test -- tests/welfare/name-precedence.test.ts`
   - RED：11 tests，4 failed／7 passed。
   - 預期失敗分別為指定反例、已確認別名等價案例、敘事保留與另一處長候選共存、真實人物編輯器姓名／角色／人工確認後 render。
2. 完成同起點且區分清單來源的實作，執行：
   `npm test -- tests/welfare/name-precedence.test.ts tests/welfare/engine.test.ts tests/welfare/local-identifiers.test.ts tests/welfare/bulk-people.test.ts tests/welfare/ui.test.ts`
   - GREEN：5 files／70 tests passed。
3. 自我檢查補上機構規則分類同名的回歸案例，先執行新測試檔：
   - RED：12 tests，1 failed／11 passed。
   - 若只檢查 category，機構規則 `姓名：陳美惠123` 會被錯當臨時人物提案，輸出 `[母親A]123`。增加 `source === 'person'` 限定，確保原規則完整遮罩。
4. 重跑相同五檔聚焦命令：
   - GREEN：5 files／71 tests passed。

## 回歸覆蓋

新測試共 12 項：

- 指定已確認姓名反例，輸出母親標記並保留原敘事；finding 身分及原文範圍正確。
- 明確人工確認別名具相同效果。
- 未確認人物無法壓過臨時長候選。
- 明列較長人物維持既有選擇，分別涵蓋未確認與已確認。
- 明列較長別名也不會被當臨時候選刪除。
- 已確認／未確認人物共用別名保持一般姓名且沒有 personId。
- 其他案件的同名已確認人物不提供優先權。
- 另一處長候選從不同位置開始（`周陳美惠`）仍完整作一般姓名處理。
- 機構規則分類即使稱為姓名，也維持完整原規則遮罩。
- 已確認 `Alex` 不會壓掉臨時候選 `Alexandra`。
- 真正掛載的 UI 人物編輯器，依序改姓名、角色、確認，再切到覆核；畫面精確保留 `案母：[母親A]陪同會談。`，且項目／全文仍未覆核。

## 最終驗證與自審

- `npm test`：49 test files passed，**593 tests passed**，exit 0（本次新增 12 項）。
- `npm run build`：TypeScript／Vite 正式建置通過，exit 0；358 modules，35 license／notice files。
- `git diff --check`：exit 0。
- 完整測試仍有原先存在的 OCR traineddata／語言與解析度診斷；Vite 仍有大型 PDF chunk 警告。均未造成失敗，且本次未改 OCR、PDF 或打包設定。
- 自審確認沒有依賴新增、網路請求、儲存、文件格式處理、角色推測或介面生產碼變更；linear map 建立避免對全部候選做平方次兩兩掃描。
- Root 另已回報真正瀏覽器編輯→確認→覆核→匯出→TXT 下載回讀成功，證據為 `artifacts/confirmed-name-after-20261021.json`；此為 root 執行的獨立驗收，本子任務沒有重複宣稱自行執行。

## 提交範圍與剩餘工作

只提交 engine、上述測試與本報告。工作期間 root 正在修改的 `docs/review-improvements-verification.md` 不納入本提交。沒有 blocker；PR、獨立 review、CI 與發布由 root 完成。沒有停止 4180 dev server、切換分支或部署。
