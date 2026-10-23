# 生活事項管理系統

生活事項紀錄、設備維護履歷與 Google 日曆定期提醒系統。

目前首頁與詳細頁共用同一套資料存取層，可選擇 Google Sheets 雲端模式或本機 Mock 模式。雲端使用現有 Apps Script Items CRUD、MaintenancePlans 保養計畫及 MaintenanceRecords 完成紀錄；事項照片使用私人 Google Drive；Google 日曆提醒由私人 Apps Script 定期處理，網站透過 Web App v3.1 讀取同步紀錄。

雲端事項的「照片」分頁及每筆已儲存完成紀錄的「查看照片與附件／上傳」區塊，可用已授權的私人 Google Drive 上傳多張 JPG／PNG／WebP（每張最多 10 MB）及 PDF（每份最多 20 MB）。照片可放大、切換、更換；PDF 可站內預覽或下載。兩者均可移入 Drive 垃圾桶。更換照片會先上傳並核對新照片，再處理舊照片；若第二步失敗，畫面會保留新照片並提示部分完成。所有操作只針對目前 owner 且具備正確 `appProperties` 的附件。Token 僅在記憶體中，重新整理後需重新授權。Mock 資料與私人 Drive 附件互不轉存；不建立公開分享連結或執行永久刪除。

## 技術架構
- 前端：React + TypeScript + Vite
- 部署：GitHub Pages
- 後端：Google Apps Script
- 資料庫：Google Sheets
- 圖片：Google Drive
- 提醒：Google Calendar

## 開發工具
Codex Cloud

## 第一階段：可操作的前端與 Mock API

目前已實作 React + TypeScript + Vite 響應式應用。第一階段不連接 Google 服務，也不需要密碼或 API 金鑰；上述 Google 技術為後續階段規劃。

### 本機開發

建議 Node.js 24（CI 使用相同版本）。

```bash
npm install
npm run dev
```

開啟終端顯示的網址，路徑為 `/life-records-manager/`，預設連接埠 5173。若受限雲端環境的預設 npm 快取無法寫入，使用 `npm install --cache /tmp/life-records-npm-cache`。

```bash
npm test                 # 日期計算、Mock API、資料保護測試
npm run build            # TypeScript 檢查與正式建置，輸出 dist/
npm run preview          # 預覽正式建置，預設連接埠 4173
```

瀏覽器操作測試（先建置）：

```bash
npx playwright install chromium
npm run test:e2e
```

本次雲端環境已有 Chromium，可直接執行 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`，不需另行下載。

Linux 若缺少瀏覽器系統依賴，可由具權限的管理者執行 `npx playwright install --with-deps chromium`。可使用 `PLAYWRIGHT_BROWSERS_PATH` 指定可寫入的瀏覽器安裝路徑，安裝與測試時需保持相同值。

### 使用方式

1. 首頁按「新增生活事項」，輸入名稱、日期、分類與選填的品牌、地點、金額和購買安裝說明。
2. 點選事項卡片進入詳細頁面，可編輯基本資料。
3. 「定期子項目」可新增或編輯保養週期：30、60、180、365 天或 1–36500 天的自訂週期。
4. 按「完成保養」，記錄實際日期、金額、備註和照片。完成日期不能晚於今天或早於事項日期。
5. 下次保養日期 = 此子項目最近的實際完成日期 + 週期；無完成紀錄則採基準日。補登較早紀錄不會把下次日期往回推。日期依日曆天計算，不受日光節約時間影響。
6. 「歷史紀錄」顯示保養明細及照片；「備註」可新增多筆文字；「照片」可保存設備與憑證照片。
7. 首頁支援搜尋、分類篩選、30 天內到期和逾期統計，以及依到期日排序的保養清單。

首次開啟提供完整「電熱水器」示範：購買安裝資料、加熱棒更換、水垢清理、安全檢查與三筆保養紀錄。示範圖片為專案內附 SVG 插圖，不是真實設備照片。

### 資料與限制

- Mock API 使用非同步介面，資料儲存在此瀏覽器此網站來源的 `localStorage`，鍵名為 `life-records-manager:v1`。只有尚無資料時才提供示範資料；不重設既有資料。
- 第一階段沒有跨裝置同步、登入、雲端備份、Google Calendar 通知或 Google API 呼叫。不同瀏覽器、網域和連接埠各自保存資料。
- 清除網站資料會遺失紀錄；請勿將這個階段視為正式備份系統。儲存空間不足會顯示錯誤並保留原始資料，損壞或不支援的資料版本不會被範例覆寫。
- 使用者上傳照片儲存為 Data URL。支援 JPG、PNG、WebP，每次最多 4 張、每張最多 800 KB；瀏覽器總容量仍有限。未提供刪除功能，以避免第一階段誤刪紀錄。
- 模型已將事項照片與各次保養照片分開；第二階段可替換 `src/api/mockApi.ts`，後續再將圖片改存 Google Drive。

### 程式結構

```text
src/
  models.ts                 資料型別
  api/mockApi.ts            非同步 Mock API、資料持久化及驗證
  data/seed.ts              電熱水器示範資料
  lib/dates.ts              日期、到期計算與金額格式
  lib/photos.ts             圖片檔案驗證與讀取
  components/Dashboard.tsx  首頁、搜尋與保養摘要
  components/Detail.tsx     詳情、子項目、歷史、備註與照片
  components/Forms.tsx      對話框與各項表單
  api/itemsRepository.ts    共用資料介面、Sheets 轉換與差異更新
  api/itemsStore.ts         單一資料來源狀態與連線生命週期
  hooks/useItemsStore.ts     React 訂閱共用狀態
  App.tsx                   共用首頁／詳細頁的 Hash 路由
  styles.css                響應式介面
public/heater.svg            本機示範插圖
tests/                      單元及手機／桌面瀏覽器測試
.github/workflows/deploy.yml GitHub Pages 建置與部署
```

### GitHub Pages 部署

1. 到儲存庫 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
2. 將程式碼推送到 `main`，或在 Actions 手動執行 **Deploy to GitHub Pages**。
3. 工作流程會執行 `npm ci`、`npm test`、`npm run build`，成功後部署 `dist/`。
4. 部署完成後網站網址為 `https://bacardi1117-ai.github.io/life-records-manager/`。

`vite.config.ts` 的 `base` 已設為 `/life-records-manager/`；頁面採 `#/items/<id>` 路由，重新整理詳細頁不需伺服器 rewrite。若改儲存庫名稱或使用自訂網域，需同步調整 base。GitHub Actions 使用平台內建短期權限，不需設定個人存取權杖或 Google 憑證。

### 提交與推送

先檢查 `git status` 及 `git diff`。在本次工作分支建立提交，推送分支後建立 PR 至 `main`：

```bash
git add .
git commit -m "feat: build phase-one life records manager"
git push -u origin HEAD
```

合併至 `main` 後會觸發部署。若目前就在 `main`，推送會直接觸發部署；請先確認分支與團隊流程。不要加入 `.env`、使用者照片、`node_modules/` 或 `dist/`。

## 統一首頁與詳細頁的資料來源

### 設定及模式選擇

本次變更須在 PR 合併並完成 GitHub Pages 部署後才會出現在正式網站。

1. 開啟「連線設定」（`#/settings`），貼上自己的 Apps Script `/exec` URL，按「連線並使用 Google Sheets」。不要將真實網址放進程式、README、Issue 或 PR。
2. 維持 Apps Script「只有我自己」權限。必要時先在新分頁登入部署所屬 Google 帳號，再回來連線。網址須為 HTTPS、`script.google.com` 的 `/macros/s/<deployment-id>/exec`，不含查詢參數或片段。
3. ready 握手及 getItems 成功後，首頁直接顯示雲端事項，點擊卡片即開啟原有詳細頁 `#/items/<item_id>`。不再需要進入獨立雲端清單；舊 `#/cloud` 入口也呈現同一套首頁。
4. 介面持續顯示「Google Sheets 雲端模式」或「本機 Mock 模式」。成功連接 Google Sheets 會選用雲端模式。重新整理自動依所選來源載入；雲端錯誤只會停止寫入，絕不自動改用 Mock。
5. 「切換為本機 Mock」會先顯示來源不同的提示，確認後才切換。Mock 選擇會被記住，即使仍保留有效雲端網址，也不會在重新整理後擅自換來源。
6. 舊版本已有網址但尚未儲存模式時，優先選用雲端並重新連線。沒有網址或模式設定的新使用者可使用原本 Mock。若明確選擇雲端但網址遺失或無效，會顯示設定錯誤，不回退 Mock。

### 正式 Items 操作

- 首頁、詳細頁與統計均讀取相同來源的 Items。詳細頁開啟時以 item_id 呼叫 getItem，不沿用其他事項的快取。
- 基本資料包含名稱、分類、事項日期、金額、品牌、型號、位置、保固日期及狀態。雲端首頁從同一組保養計畫與完成紀錄 API 彙整逾期、近期保養及保養費用；事項購買金額不混入保養費用。
- 「編輯資料」以表單開啟時的資料為基準，只送出實際修改欄位的 `updateItem({item_id, changes})`。未更動的欄位不會覆寫後端同期變更；沒有修改時不呼叫 updateItem。
- 寫入確認後以同一 item_id 重新呼叫 getItem，使用後端結果更新詳細頁、首頁卡片與統計。狀態變更使用既有 archiveItem/restoreItem。
- 首頁新增呼叫 createItem，使用回傳物件的 item_id 開啟詳細頁，並重新讀取該筆資料；不使用前端產生的替代 ID，不建立 Mock 副本。
- 雲端寫入失敗時保留表單內容、不顯示儲存成功，並停用雲端寫入。可按「重新讀取資料並保留草稿」核對後端狀態。寫入逾時可能已在後端完成，不能直接重複新增。
- 已確認寫入、但後續單筆讀取失敗時，關閉已送出的表單，保留舊畫面並顯示「雲端寫入已確認，但重新讀取該筆資料失敗」，不假裝畫面已更新，也不重送寫入。
- 不同 item_id 的回應會核對 ID；舊頁面、舊連線的延遲回應不得覆蓋目前選取的事項。

### 尚未支援的功能與本機資料保護

雲端支援 Items CRUD、MaintenancePlans 計畫管理與 MaintenanceRecords 完成紀錄新增／查詢。完成後從後端重讀最近完成日期、下次保養日及歷史。完成紀錄刪除／更正及本機購買安裝說明尚未串接雲端 API；網站透過 Web App v3.1 讀取 CalendarSync 同步紀錄，Google Drive 已支援事項私人照片上傳與授權讀取。私人 Apps Script 負責日曆事件同步，網站沒有日曆寫入權限。Mock 保養、歷史及照片功能維持原有行為。

- 本機事項仍使用 `life-records-manager:v1`；沒有遷移、覆寫或刪除既有資料。
- Web App URL 使用 `life-records-manager:apps-script-url:v1`。
- 資料來源選擇使用 `life-records-manager:data-source:v1`（cloud 或 mock）。
- 雲端 Items 與 MaintenancePlans 僅存在工作階段記憶體，不寫入 Mock localStorage。切換來源會清理畫面快取，但不刪除任何本機紀錄，也不自動上傳範例。
- 移除雲端網址不等於切換 Mock；如果原本在 Mock 模式，移除網址也不影響本機操作。

### 共用資料架構

所有 React 畫面透過 `useItemsStore` 訂閱同一個 `ItemsStore`，並呼叫同一層操作。畫面元件不直接使用 Mock API 或讀寫 localStorage。

- `src/api/itemsRepository.ts`：共用 ItemsRepository 介面、Sheets 欄位對應、差異欄位更新、寫入後讀取、Mock／雲端實作。雲端映射不與 Mock 依 ID 合併；未支援子資料固定為空且不可寫入。
- `src/api/itemsStore.ts`：模式選擇、連線、來源內的清單及單筆快取、寫入狀態、失敗保護與延遲回應隔離。
- `src/hooks/useItemsStore.ts`：React 狀態訂閱及生命週期。
- `src/components/Dashboard.tsx`、`Detail.tsx`、`Forms.tsx`：同一套首頁／詳細頁／表單，依資料來源啟用支援的操作。
- `src/api/connectionSettings.ts`：集中處理本機網址與資料來源設定。
- 已移除舊 `SheetsItems.tsx` 與 `useSheetsConnection.ts`，避免出現兩套可獨立寫入的資料來源。

### 橋接協定

保留現有 iframe + postMessage Adapter；不直接跨網域 fetch，也不修改 Apps Script 後端。參考來源為 [keeping_accounts/app.js](https://github.com/bacardi1117-ai/keeping_accounts/blob/5c6184392665a466b46ba732d484daf3448bfb03/app.js) 與 [Bridge.html](https://github.com/bacardi1117-ai/keeping_accounts/blob/5c6184392665a466b46ba732d484daf3448bfb03/apps-script/Bridge.html)。

| 前端 action | 後端橋接函式 | payload |
| --- | --- | --- |
| getItems | bridgeGetItems | {} |
| getItem | bridgeGetItem | { item_id } |
| createItem | bridgeCreateItem | Items 可編輯基本欄位 |
| updateItem | bridgeUpdateItem | { item_id, changes }，changes 只含修改欄位 |
| archiveItem | bridgeArchiveItem | { item_id } |
| restoreItem | bridgeRestoreItem | { item_id } |

共用封包為 channel `life-records-v1`、每次新連線的 UUID token、type；request 有 id/action/payload，response 有相同 id、布林 ok 與 result 或 error。getItems 直接回傳陣列；getItem 回傳單一 Items 物件。createItem 成功回傳物件必須含非空 item_id，若缺少則停止寫入並要求重新讀取核對，不製造替代紀錄。

DTO 使用 item_date、warranty_date、數值 amount、active/archived 狀態及字串 ID／時間戳。UI 的 date/model/warrantyDate/status 對應後端欄位；更新只允許 name、category、item_date、amount、brand、model、location、warranty_date。保固日期可為空字串。

### 安全與真實連線限制

HtmlService 使用內層 iframe；Adapter 以合法 Google origin 與當次 token 的 ready 訊息固定來源視窗，後續核對 channel、token、source、origin 及 request ID。這些是通訊關聯機制，**不是使用者身分驗證，不能保護匿名公開的寫入 API**。維持「只有我自己」部署設定。

使用者已回報既有後端 Items 可新增、查詢及修改；本次不變更後端。本次測試使用合成 URL／資料與攔截網路的模擬 iframe，不代表重新驗證了真實 Google 登入或試算表。Google 登入頁禁止嵌入、第三方 Cookie、跨網站限制與後端允許來源仍可能影響實際使用；錯誤會保留在雲端模式顯示。

### 測試

執行 `npm test`、`npm run build`，再執行 `npm run test:e2e`（本雲端環境加上 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`）。測試使用不存在的合成 deployment ID，不含真實 URL、Token 或私人生活資料。

- 共用 repository：欄位映射、只更新差異、後端 ID、寫入後讀取、錯誤結果、未支援操作保護。
- 共用 store：來源優先順序、手動 Mock 選擇持久化、失敗不回退、延遲回應隔離、本機資料保護。
- Playwright 桌面／手機：首頁至詳細頁一致、修改金額與日期、重新整理、只更新指定 ID、新增無 Mock 副本、保留失敗草稿、確認切換模式、停止未支援同步操作，以及既有 Mock 功能回歸。

## Google Sheets 定期子項目

沿用既有連線設定及 Apps Script v2.0 Bridge，不需要 Google Sheets API 或 OAuth，也不修改後端。PR 合併及部署後，連線成功即可進入原本的事項詳細頁「定期子項目」分頁。

1. 以目前 `item_id` 自動讀取保養計畫；顯示名稱、週期、計算模式、下次保養日、提前提醒天數及啟用狀態。
2. 「新增子項目」可設定名稱、正整數週期、天／月／年、完成日起算／固定週期、基準日期及非負整數提醒天數。
3. 編輯只傳送實際修改的可編輯欄位。ID、啟用狀態、完成日期、下次日期、建立及更新時間不出現在一般編輯 payload。
4. 可停用或重新啟用；停用仍保留在原清單中，並非刪除。
5. 每次新增、修改、停用及啟用後重新查詢同一事項的清單，以後端結果更新畫面。下次日期不由前端推算，字串日期不轉換時區；時間戳保持後端格式。
6. 讀寫失敗顯示錯誤，保留原清單／未送出草稿，暫停計畫寫入。使用「重新讀取保養計畫」或表單中的「重新讀取計畫並保留草稿」核對後再操作。逾時表示結果未知，請先核對清單，勿直接重複新增。
7. 若寫入已確認但後續讀取失敗，關閉已送出表單且不顯示成功訊息，要求重新讀取。儲存期間停用重複提交。
8. 提前提醒天數目前只保存設定，不代表已寄信、推播或建立行事曆提醒。已啟用計畫可新增完成紀錄；停用計畫的完成操作不可用。

| action | payload | 回傳 |
| --- | --- | --- |
| getMaintenancePlans | `{ item_id }` | MaintenancePlan 陣列 |
| getMaintenancePlan | `{ plan_id }` | MaintenancePlan 或 null |
| createMaintenancePlan | `{ item_id, name, interval_value, interval_unit, calculation_mode, base_date, reminder_days }` | success、plan_id、item_id、name、next_due_date |
| updateMaintenancePlan | `{ plan_id, changes }` | success、message、plan |
| disableMaintenancePlan | `{ plan_id }` | success、plan_id、enabled=false、message |
| enableMaintenancePlan | `{ plan_id }` | success、plan_id、enabled=true、message |

`src/api/maintenancePlans.ts` 負責型別與嚴格解析、白名單、ID／所屬事項檢查；`ItemsStore` 管理雲端計畫狀態與寫入後讀取。`CloudMaintenancePlans.tsx` 嵌入既有詳細頁分頁，使用原有排版與 Modal；Mock 仍使用原 TaskForm 及本機保養資料，不遷移或混入雲端計畫。

新增單元與手機／桌面 Playwright 測試涵蓋：依事項載入、新增及修改後重新讀取、停用／啟用、重新整理、讀寫錯誤、保留草稿、寫入確認後讀取失敗、未知寫入結果、重複提交防護、延遲回應隔離及來源切換。原有 Items CRUD 與 Mock 測試持續執行。**這些是模擬 Bridge 測試，未驗證本次 MaintenancePlans 的正式 Google Sheets 讀寫。** 實際 iframe 登入與跨網站限制仍須以使用者部署環境另外驗證。

## Google Sheets 保養完成紀錄（Web App v3.0）

雲端模式沿用同一個 iframe + postMessage Bridge，在原本事項詳細頁的「定期子項目」點選已啟用計畫的「完成保養」。表單顯示不可更換的計畫，預設今天及計畫名稱，可填完成日期、標題、非負費用、廠商與最多 5000 字備註。照片可在完成紀錄成功儲存後透過私人 Drive 另行上傳；網站手動日曆同步與完成紀錄刪除／更正目前不可用。

Bridge 新增 `createMaintenanceRecord`、`getMaintenanceRecords`、`getMaintenanceRecord`、`getMaintenanceRecordsByItem` 四個 action。建立 payload 僅含 `record_id`、`plan_id`、`completed_date`、`title`、`amount`、`vendor`、`description`，不由前端修改計畫的最近完成日或下次保養日。成功（包含 `duplicate: true`）後重新讀取該事項計畫及事項／子計畫完成紀錄，詳細頁使用後端回傳的日期及金額；首頁統計會依雲端完成紀錄計算累計、年度與最近 12 個月費用，按 record_id 去重。雲端歷史按完成日期由新到舊，逐筆展開完整備註及私人附件，並按 item_id／plan_id 隔離。

每份尚未確認的草稿使用同一個 `crypto.randomUUID()` record_id；本瀏覽器分頁的 `sessionStorage` 在重整時保留這份草稿，鍵名 `life-records-manager:pending-cloud-records:v1`，與 Mock 的 `localStorage` 完全分開。送出逾時或結果不確定時，先以 `getMaintenanceRecord` 查原 ID：若已存在且內容一致則重讀資料；若查不到，可由使用者沿用同一 ID 重試；若查詢也失敗則暫停送出，直到查明。後端明確衝突或內容不符會停止重試。已確認寫入但後續重讀失敗時同樣不重送。`duplicate: true` 視為原紀錄已存在，重讀後顯示明確結果。

詳細頁的雲端保養費用只在 `getMaintenanceRecordsByItem` 成功後依真實 `amount` 加總，按 `record_id` 去重。讀取失敗顯示無法確認，不把 0 元當作真實結果。切換事項會清理畫面狀態；切換資料來源不會刪除既有 Mock 或未確認的草稿。

單元及 Playwright 測試使用不存在的合成部署 URL，測試伺服器攔截所有 Google 請求。**測試通過不代表本次已完成正式 Google Sheets 實際讀寫驗證。** 真實 Google 登入、iframe 與 Web App v3.0 行為需另行驗證；本前端工作未修改 Apps Script 或建立試算表。

## Google Calendar 同步狀態（Web App v3.1）

正式雲端模式預設啟用 `getCalendarSyncStatus({ plan_id })`，沿用既有 Web App URL 及 life-records-v1 iframe Bridge。進入詳細頁或重新整理時依保養計畫讀取；新增、修改、停用、恢復及完成保養後重新讀取。Mock 不呼叫此 API。舊版部署可在建置時設定 `VITE_CALENDAR_SYNC_STATUS_API_ENABLED=false` 暫時關閉讀取。

API 回傳 `{ plan_id, sync_status, last_synced_at, error_message, has_event }`，前端不顯示 Calendar ID 或 Event ID。synced 顯示「Google Calendar 已同步紀錄」、disabled 顯示「提醒已停用」、not_synced 顯示「尚未同步」、error 顯示「同步失敗」；讀取失敗顯示「同步狀態讀取失敗」。此處僅根據 CalendarSync 紀錄，不代表已即時查證 Google Calendar 事件。私人 Apps Script 每 15 分鐘檢查，網站沒有日曆寫入或手動同步權限。

時間比較由 `src/lib/calendarTimestamps.ts` 處理：無時區的 `YYYY-MM-DD HH:mm:ss` 或 `YYYY-MM-DDTHH:mm:ss` 依台北 UTC+08:00 解讀；ISO 的 Z 或明確 offset 則依其時區轉換。同一時間不會因瀏覽器時區不同而產生不同結果。synced 紀錄早於計畫 updated_at 時顯示「等待下次同步」；時間無效、事件不存在或狀態不一致時顯示「無法確認」。時間字串維持後端原樣顯示。

`npm test`、`npm run build` 與 `npm run test:e2e` 預設測試已啟用的前端。測試只使用合成 Bridge，未驗證正式 Web App v3.1、CalendarSync 工作表或私人排程。若要測試關閉旗標，可先以 `VITE_CALENDAR_SYNC_STATUS_API_ENABLED=false npm run build` 建置，再執行 `CALENDAR_SYNC_E2E_ENABLED=false npm run test:e2e -- tests/e2e/calendar.spec.ts`；完成後用一般 `npm run build` 恢復正式啟用產物。

## 雲端備註（Web App v3.2）

生活事項的「備註」分頁及定期子項目卡片的「查看備註」沿用現有 Notes Adapter 與 iframe Bridge。雲端模式預設啟用 `getNotes`、`getNote`、`createNote`、`updateNote`；沿用目前 Web App URL，不另行設定。新增前端產生 UUID，未確認的重試保留同一 ID，先查詢原 ID；成功後重新讀取該 owner 的清單。編輯僅能改標題與內容；不提供實體刪除或封存。Mock 模式仍使用原本本機備註，不會自動轉存。

此版以前端提供的 v3.2 契約開發，模擬測試不代表正式 Web App 或 Notes 工作表已完成實際讀寫驗證。若部署端尚未提供 Notes action，可在建置時設定 `VITE_NOTES_API_ENABLED=false` 暫時顯示未連接狀態。契約細節見 `docs/notes-bridge-contract.md`。

## 私人 Google Drive 授權（第一階段）

GitHub Actions 的 Repository Variable `VITE_GOOGLE_CLIENT_ID` 會在 Pages 的 `npm run build` 階段注入。此 Client ID 是網頁應用程式的公開識別碼，不是 Client Secret。未設定時，雲端模式的「照片」分頁顯示「Google Drive 尚未設定」，不嘗試授權。

正式網站中，先使用已有的 Google Sheets 連線開啟一筆生活事項，切到「照片」，按「連接私人 Google Drive」，使用已列為 OAuth 測試使用者的 Google 帳號完成授權。網站只請求 `https://www.googleapis.com/auth/drive.file`，取得 Access Token 後呼叫 Drive API 的唯讀清單端點檢查基本連線。授權及驗證成功才顯示「Google Drive 已授權」。可在同一區塊取消授權；Token 到期、授權視窗取消或 API 拒絕時會顯示錯誤並可重新授權。Token 僅在目前網頁的記憶體中，重新整理後需重新授權。

Drive 操作不使用 Apps Script Bridge；不提供永久刪除、分享或公開連結；Mock 照片繼續存在原本的本機資料來源。模擬 GIS／Drive API 測試不代表正式 Google 帳號操作已驗證。

## 私人 Google Drive 事項照片（第二階段）

雲端事項的「照片」分頁可一次選取多張 JPG、PNG、WebP（每張最多 10 MB）。網站以使用者的 drive.file 授權，將照片放進私人 Drive 的「日日有序 Life Records」資料夾及對應 item_id 子資料夾；檔案的 appProperties 記錄 attachment_id、owner_type=item、owner_id=item_id。重新授權後會重新查詢檔案，縮圖透過授權 Drive API 讀取並使用暫時的 Blob URL 顯示，不使用公開圖片網址。

每張照片的待送識別碼與 SHA-256 指紋暫存於該分頁的 sessionStorage；不儲存 Access Token。上傳回應不確定時，會先以相同 attachment_id 查詢，仍無法確認時停止再次送出，避免重複建立附件。資料夾 ID 的本機快取會再向 Drive 驗證，重新整理後先查找既有資料夾。模擬測試不等於正式 Google Drive 上傳驗證。

## 私人 Google Drive 保養完成紀錄照片

雲端「歷史紀錄」中的每筆完成紀錄，以及定期子項目展開的完成紀錄，均可展開該筆歷史紀錄查看照片與附件及上傳操作。紀錄照片與事項照片沿用同一 Drive Adapter，但使用獨立資料夾及 `appProperties`：`attachment_id` 為 UUID、`owner_type=record`、`owner_id=record_id`。上傳、更換和移入垃圾桶前會向 Google Sheets 讀回原 `record_id`，確認紀錄確實存在且屬於目前事項；每次 Drive 操作也會核對檔案擁有者與附件 ID。不同紀錄、事項照片與 Mock 照片不互相混用。網站不修改 Sheets Attachments 工作表或 Apps Script。模擬測試通過後，仍需在正式帳號驗證上傳、重新授權、放大預覽、更換與移入垃圾桶。

## 私人 Google Drive PDF 文件

事項與已儲存保養完成紀錄的照片區塊也提供獨立 PDF 文件清單，可一次選取多份 `application/pdf`，每份最多 20 MB；清單顯示檔名、大小、建立日期。網站檢查檔案 MIME 與 `%PDF-` 標頭，使用原本的 Drive 資料夾、`attachment_id` 和 resumable upload session。網路中斷時先查詢同一 session 的已收位元組並續傳；結果仍不明時保留原附件 ID，核對前不以新 ID 再建檔。事項或紀錄上傳前會再次從 Sheets 確認該筆已儲存。

預覽時由授權 Drive API 取得內容，短暫的 Blob URL 在關閉視窗時釋放；瀏覽器無法預覽時可按「下載原始 PDF」。刪除會先核對 Drive file ID、`owner_type`、`owner_id`、`attachment_id`，再以 `trashed=true` 移入垃圾桶。不修改 Apps Script 或 Sheets Attachments 工作表，不提供公開連結。模擬測試不代表正式 Drive PDF 上傳、續傳、預覽或刪除已驗證。

## 首頁保養看板與私人封面

首頁從目前所選資料來源讀取 Items、MaintenancePlans 與 MaintenanceRecords。雲端會逐項讀取並在全部成功後更新看板與「最後成功更新」時間；任一保養資料讀取失敗時顯示錯誤，不把缺失資料當作零元或空提醒。可使用首頁的重新讀取按鈕刷新 Items 與看板；Mock 仍只使用本機資料，不自動上傳。

逾期、未來 7 天及未來 30 天按 Asia/Taipei 的日曆日期比較；保固日期分為已到期、30 天內到期、尚未到期與未填寫。搜尋支援名稱、品牌、型號與位置，並可同時使用分類、狀態、保養計畫及到期篩選。保養費用只加總完成紀錄，不含設備購入金額，並顯示年度、最近 12 個月、各事項排行與月度趨勢。

雲端「照片與附件」可對事項照片按「設為封面」。此偏好儲存在該私人 Drive 檔案的 appProperties 中，首頁只有在目前分頁已授權 Drive、卡片靠近畫面時，才透過與照片分頁相同的 item_id 私人照片清單查詢封面，接著以授權 API 讀取圖片並產生暫時 Blob URL。取消授權、權限過期或封面被移入垃圾桶後，首頁顯示預設圖示。此封面 metadata 更新目前只有模擬 Drive 測試，仍需在正式帳號驗證。

## 獨立保養月曆（第二階段 2A）

上方「保養月曆」導覽或首頁「查看完整月曆」可開啟 `#/calendar`。月曆與首頁共用 ItemsStore 的 Items、MaintenancePlans、MaintenanceRecords 資料及最後成功讀取時間；雲端讀取不完整時顯示錯誤，不以 Mock 或零筆假裝成功。月曆可以切換月份、回到本月、選擇日期及篩選事項，桌面顯示整月事件，手機則可選日期查看完整清單。保養計畫事件只使用後端的下一次到期日，停用計畫不顯示；完成紀錄按 record_id 獨立列出。不推算下一輪以後的未來週期。日期以 Asia/Taipei 的日曆日比較。

點選預定事件會進入原事項詳細頁並定位保養子項目；點選完成事件會切換到歷史紀錄並定位該筆紀錄。首頁小日曆可切換逾期、7 天內及第 8–30 天提醒，避免同一計畫在三組近期清單重複列出。此頁僅檢視網站資料，不嵌入或寫入 Google Calendar；既有私人日曆同步照常運作。

首頁私人封面改為逐個可見事項使用已驗證的 owner-scoped Drive 清單，避免全 Drive 的 appProperties 查詢與照片分頁結果不一致。重新整理後需先重新授權 Drive 才會看到私人封面。此修正已通過模擬 Drive 測試，正式帳號仍需驗證。
