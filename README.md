# 生活事項管理系統

生活事項紀錄、設備維護履歷與 Google 日曆定期提醒系統。

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
