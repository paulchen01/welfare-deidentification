# Task 1 完成報告：社福規則與人物核心

## 交付範圍

僅新增本任務檔案：`src/welfare/types.ts`、`policies.ts`、`engine.ts`、`samples.ts`、`tests/welfare/engine.test.ts` 與本報告。未改動上游 `src/core/`、格式處理器、原 UI、入口或 package 設定；父代理的整合變動不屬本提交。

固定介面均已實作：detectWelfare、proposePeople、createManualFinding、findingsToEdits、renderText；PURPOSES、DOCUMENT_KINDS、PERSON_ROLES；WELFARE_SAMPLES 共 60 筆。

## 行為與設計

- 重用原本 detect/BUILTIN_PATTERNS 的特定直接識別規則；明確不啟用泛用中文姓氏猜名與未標示統編猜測。直接識別資訊完整遮蔽，不留姓氏或號碼尾碼。
- 追加社福案號、通報、病歷、公文、安置編號、銀行帳號、舊／新居留證格式；標籤式機構、學校、醫院、村里、職業、健康、保護及經濟資訊；常見未標籤機構與高風險詞條；日期、年齡及金額。
- 候選人物一律 `confirmed=false`、`role=待確認`、無推測關係及別名連結。除明確姓名欄位外，只對角色後帶先生／女士／同學的有限姓名格式提供建議，避免將一般服務敘事當成姓名。
- 只讀取相符 groupId 的人物，已確認姓名及明列別名共用角色標記；同角色依輸入順序分配 A/B/.../AA。重複名稱指向多位已確認人物時回退 `[姓名]`，不附 personId，並提示歧義。不同案件不共用人物。
- 內部用途保留必要敏感脈絡，但每項仍為未覆核；外部 AI／公開用途遮蔽。公開日期採年月加上／中／下旬；年齡與金額提供可選建議，金額不自動套用區間。概化結果不使用可逆標記，交由父代理 occurrence map 區分。
- 自動標籤偵測的 source 一律 `rule`；`field` 保留給父代理的使用者整欄選取。這使用途重新分析不會把舊的自動保留策略當成人工決定。
- 所有建議都有未覆核狀態及規則局限訊息。沒有宣稱零洩漏。
- 高優先直接識別不被較短 alias 覆蓋。重疊敏感脈絡切分後保留剩餘區間，避免整段建議被丟棄後留下敏感敘事；輸出排序且沒有重疊 span。
- 套用前檢查整數與界內位置、原文相符、Unicode surrogate 邊界、重疊與 action；遮蔽需完整單一方括號標記，拒絕括號注入、控制與方向字元；概化缺建議時拒絕。keep 不編輯。手動選取為 reviewed=true 並拒絕既有範圍重疊。
- 機構規則僅允許 1–64 字有限文字前綴，全部 escape 為 literal，不接收任意正規表示式；數字 1–24 位，min<=max，最多 50 條。相同輸入得到相同 finding ids/結果；無 fetch、原文 logging 或瀏覽器儲存。

## TDD 與驗證證據

已讀 `test-driven-development` 與 `verification-before-completion` skill。

1. 先寫 19 個行為測試及僅供匯入的空實作。首次執行先遇 npm ci/audit fix 更新中缺少 undici，之後 sandbox temp rename EPERM；這兩次均不是 RED，沒有將其列為行為驗證。
2. 已批准的外部沙箱測試命令成功啟動後，明確 RED：**15 failed / 4 passed**，測試指出空 findings、缺失角色標記、無遮蔽、缺少樣本與手動操作未實作。
3. 實作後 GREEN：**19/19 passed**。
4. 自審增加 regression tests，RED **5 failed / 18 passed**：角色後一般敘事被誤當姓名、短數字 alias 造成帳號／手機剩餘位數外露、日期吃掉相鄰空白、方向控制字元可進 marker、樣本結語被改寫。修正後 **23/23 passed**。
5. 依父代理指出 source 契約補測：RED **1 failed / 23 passed**；自動標籤改 rule 後 **24/24 passed**。
6. 另補未標籤保護／經濟／健康分類回歸測試：RED **1 failed / 24 passed**；修正後最後一次 GREEN **25/25 passed**。

最後命令：

```powershell
node --no-experimental-webstorage node_modules/vitest/vitest.mjs run tests/welfare/engine.test.ts --environment node
```

結果：1 test file passed，25 tests passed；2026-10-18 17:01:32，duration 339ms。Node25 的 global localStorage 與 jsdom 衝突由父代理處理，domain suite 用 node 環境。此處未重跑原版全部測試，依任務分工由父代理統一跑完整 suite。

`tsc --noEmit` 曾於整合中執行：本任務新增檔案沒有型別錯誤；當時全專案因父代理尚未建立 `document-safety` 模組而失敗（app/export/session import 與衍生 implicit any）。**不宣稱該次全專案型別驗證通過**，最終 build 由父代理完成。

`git diff --check` exit 0；原版變動的 LF/CRLF 提示不是內容檢查失敗。

## 語料與測試解釋

60 筆皆為**模板產生的合成紀錄**，六領域各 10 筆：家庭、兒少、老人、身心障礙、心理健康、保護。每筆 8 個 expectedSensitive，合計 480 個模板敏感值標註，測試逐一檢查確實存在於輸入且未原樣出現在 AI 用途輸出。名字、角色、日期格式、電話分隔／國碼、案號及領域脈絡有變化；所有結尾實質服務敘事另檢查完整保留。

這些標註與模板同源，**不是獨立人工資料集，也不是 480 次獨立真人標註或跨來源效能估計**。另外手寫 adversarial cases 覆蓋模糊別名、外文姓名、案件隔離、電話/email/證件、假陽性、Unicode 與 offset 安全、內部／外部政策、原敘事保留。

## 自審與限制

- 規則不具通用語意理解能力；無標籤未列明姓名、罕見地名／職業／機構、特殊證件格式、隱喻式保護或醫療敘事可能漏檢。常見機構後綴與敏感詞可能過度圈選，均需人工檢查。
- 候選姓名不建立角色關係；無分隔且無敬稱的角色後名字刻意不猜，應由使用者明確輸入人物或手動選取。
- 日期以有效數字年月日為限，未解析中文數字、相對日期或所有國際拼寫日期；年／月／旬仍可能在小型社群造成再識別，公開前應由使用者判斷。
- 人物角色 suffix 依相同輸入順序穩定；任意重排人物清單後可重新分配，因此跨批次穩定清單管理由父代理 profile/session 層負責。
- 一個標記可能指向多個原始出現值，不能單靠角色 marker 回填；嚴格 roundtrip 必須用父代理的 occurrence maps。本任務只有純文字 edit，不處理 DOCX／XLSX／PDF 原始容器的洩漏與清理。
- 只允許無重疊 findings，包括 keep；遭改動原文必須重新偵測，不會悄悄套用舊 offset。
- 本任務未安裝套件、未連網、未部署，也未執行真實個案資料評估。

## 交接

核心已可供 UI、session、vault/export 呼叫；25 個核心測試已過。父代理負責完整 build/suite、document-safety 與實際容器回讀；獨立 code review 可從本提交限定檔案開始。
