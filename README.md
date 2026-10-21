# 生活事項管理系統

生活事項紀錄、設備維護履歷與 Google 日曆定期提醒系統。

目前版本保留完整本機 Mock，並新增獨立 Google Sheets Items 橋接介面。雲端串接已通過模擬測試，實際 Google 登入與部署端呼叫尚待驗證；Google 日曆提醒仍為後續規劃。

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
  App.tsx                   Hash 路由、載入與資料更新
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

## Google Sheets Items 橋接整合

### 在 GitHub Pages 設定自己的 Web App

此功能須在本 PR 合併並完成 Pages 部署後才會出現在正式網站。

1. 開啟網站上方的「連線設定」（`#/settings`）。
2. 貼上自己的 Apps Script Web App `/exec` URL，只接受 HTTPS、`script.google.com` 的 `/macros/s/<deployment-id>/exec` 路徑，不含查詢參數或片段。不要把實際 URL 寫進程式、README、Issue 或 PR。
3. 維持部署權限「只有我自己」。必要時使用「在新分頁開啟 Web App」，登入部署所屬 Google 帳號；回到網站按「連線並儲存網址」。
4. 前端在 iframe URL 附加每次新產生的 token。收到 `ready` 並成功解析 `getItems` 回傳陣列後才儲存網址，並顯示已連線。
5. 進入「雲端 Items」（`#/cloud`）即可新增、查詢、修改、封存與還原。若後端清單排除封存紀錄，可用 item_id 查詢，是否能取得封存紀錄仍取決於已部署後端。
6. 重新整理後保留網址，但不自動連線；按「連接已儲存的網址」重新建立 iframe。可中斷連線或移除網址，不影響本機 Mock 紀錄。

網址以 `life-records-manager:apps-script-url:v1` 儲存在此瀏覽器 localStorage，與 `life-records-manager:v1` 的本機事項完全分離。隨機 token 只活在單次連線記憶體與 iframe URL，不寫入設定。雲端 Items 只保存在工作階段記憶體，不寫入本機 Mock，也不自動上傳示範資料。

### 通訊協定與欄位

參考 [keeping_accounts/app.js](https://github.com/bacardi1117-ai/keeping_accounts/blob/5c6184392665a466b46ba732d484daf3448bfb03/app.js) 與 [Bridge.html](https://github.com/bacardi1117-ai/keeping_accounts/blob/5c6184392665a466b46ba732d484daf3448bfb03/apps-script/Bridge.html)。沿用 iframe + postMessage、每次連線 UUID token、ready 握手與 request ID；未使用直接跨網域 fetch。

| 前端 action | 後端橋接函式 | payload |
| --- | --- | --- |
| `getItems` | `bridgeGetItems` | `{}` |
| `getItem` | `bridgeGetItem` | `{ item_id }` |
| `createItem` | `bridgeCreateItem` | Items 可編輯基本欄位 |
| `updateItem` | `bridgeUpdateItem` | `{ item_id, changes }` |
| `archiveItem` | `bridgeArchiveItem` | `{ item_id }` |
| `restoreItem` | `bridgeRestoreItem` | `{ item_id }` |

共用封包欄位為 `channel: "life-records-v1"`、`token`、`type`。請求含 `id`、`action`、`payload`；回應為 `type: "response"`，含同一個 `id`、布林 `ok`，以及 `result` 或 `error`。

`getItems` 必須直接回傳陣列，不接受 `{items: [...]}`。`getItem` Adapter 預期直接回傳單一同型別物件；實際回傳需於部署驗證時確認。Items 欄位：

- `item_id`、`name`、`category`、`item_date`、`brand`、`model`、`location`、`warranty_date`、`created_at`、`updated_at` 為字串。
- `amount` 為非負有限數值，`status` 為 `active` 或 `archived`。
- `item_date` 為 YYYY-MM-DD；`warranty_date` 可為空字串或 YYYY-MM-DD。
- 新增與修改只送出 `name/category/item_date/amount/brand/model/location/warranty_date`。ID、狀態與時間戳由後端處理；不送出本機保養、歷史、備註或圖片欄位。

**已知部署端問題：**使用者指出目前 Bridge.html 的 ACTIONS 對照呼叫仍有待修正／驗證，由另行提供的後端修正版處理。本 PR 只使用左側 action 名稱，不修改或部署任何 Apps Script 程式，不宣稱目前部署版本一定能呼叫成功。

### 來源檢查與實際 iframe 限制

- HtmlService 有內層 iframe。Adapter 由合法 Google origin 加上當次 token 的 ready 訊息取得來源視窗，再固定該視窗與 exact origin；後續 response 必須同時符合 channel、token、source、origin、id 與布林 ok。
- 請求只送往固定來源，未使用 `*` 發送資料。重複 ready 不會替換已固定的視窗。取消、重新連線與卸載會移除 iframe、監聽器、計時器並拒絕未完成請求。
- **origin/source 檢查與隨機 token 是通訊關聯機制，不是使用者身分驗證。它們不能保護匿名公開的寫入 API。**此實作不要求將部署改成「任何人」。
- Google 登入頁的嵌入政策、第三方 Cookie、跨網站登入狀態、Google HtmlService frame 政策及後端允許的前端 origin，均可能讓「只有我自己」部署無法在 GitHub Pages iframe 中使用。新分頁可以登入，不代表 iframe 就一定可以工作。
- 真實驗證須在擁有部署權限的帳號、正式 Pages origin、實際瀏覽器中進行：先確認新分頁可用，再確認 ready、getItems 讀取及非敏感測試事項的完整操作。後端允許來源需與正式網站 origin 一致（origin 不含路徑）；本次未更改後端允許來源。
- ready 逾時不會顯示連線成功。寫入逾時可能代表後端已執行，前端不會自動重送；先重新讀取核對。寫入成功但重新讀取失敗時，會關閉已送出的表單並提示重新讀取，避免重複新增。
- 失敗時保留本機資料及上次成功讀取的雲端畫面，標為未確認最新狀態，重新讀取成功前停用寫入。未提供跨裝置同步本機資料的功能。

### 新增程式與測試

- `src/api/appsScriptBridge.ts`：iframe transport、握手、來源固定、request correlation、逾時與 dispose。
- `src/api/connectionSettings.ts`：本機 URL 設定，與 Mock 儲存隔離。
- `src/api/sheetsItems.ts`：Items DTO、欄位驗證及 action／payload 對應。
- `src/hooks/useSheetsConnection.ts`：連線生命週期、資料狀態、取消及失敗保護。
- `src/components/ConnectionSettings.tsx`、`SheetsItems.tsx`：設定與雲端 Items 操作介面。
- `tests/bridge.test.ts`、`connectionSettings.test.ts`、`sheetsItems.test.ts`：協定、生命週期、設定隔離、欄位與動作測試。
- `tests/e2e/bridge.spec.ts`、`tests/fixtures/googleBridge.ts`：以 Playwright 攔截全部 Google 測試網址，模擬 Google 外層與內層 iframe；測試檔使用不存在的合成 deployment ID，不含真實 Web App URL。

新增測試需要開發相依 `jsdom`；使用 `npm ci` 安裝。執行 `npm test`、`npm run build`，再執行 `npm run test:e2e`（本雲端環境加上 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`）。這些測試驗證前端及模擬協定，**不驗證真實 Google 登入、Sheet 寫入或部署端 ACTIONS 修正**。
