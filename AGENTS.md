# 專案規範

- React + TypeScript + Vite；使用繁體中文介面，手機與桌面都必須可操作。
- 在現有 checkout 工作；雲端任務已隔離，不另建 worktree，除非使用者要求。
- `src/models.ts` 為資料模型，`src/lib` 為純函式，`src/api` 為資料存取，`src/components` 為 UI；元件不可直接操作 localStorage。
- 第一階段使用 Mock API 與瀏覽器 localStorage；不得建立 Google 資源或加入任何密碼、金鑰、憑證。
- 日期儲存為 YYYY-MM-DD；以 UTC 日期運算避免日光節約偏移；今天使用使用者本機日期。
- 下次保養 = 最近實際完成日 + 週期；尚未完成則使用基準日。補登歷史不得倒退最近完成日期。
- 保留使用者現有資料；未知版本或損壞資料須回報錯誤，不可用 seed 覆寫。照片使用者主動選取才寫入。
- GitHub Pages base 固定 `/life-records-manager/`，以 hash 路由支援詳細頁重新整理。
- 修改後執行 `npm test` 與 `npm run build`；涉及互動時執行 `npm run test:e2e`。
- 禁止提交 node_modules、dist、.env、瀏覽器測試產物或使用者照片。

## Apps Script Items 整合規範

- 首頁與詳細頁共用 ItemsStore／ItemsRepository，禁止另建獨立雲端清單或讓元件直接操作 Mock API／localStorage。雲端映射不得混入本機子資料；禁止自動上傳示範資料。
- 透過 iframe + postMessage，禁止以 fetch 直接呼叫 Apps Script。前端 action 使用 getItems/getItem/createItem/updateItem/archiveItem/restoreItem，而非 bridge 函式名稱。
- getItems 嚴格解析直接陣列，日期欄位為 item_date；status 使用 active/archived。只傳送明確允許的基本欄位，禁止把本機歷史、圖片等附帶上傳。
- 保持「只有我自己」部署權限；本工作範圍不修改 Apps Script。實際 iframe 登入與跨網站限制須另外驗證，不能用模擬測試宣稱真實 Google 連線已驗證。
- token 與來源檢查不是使用者驗證，不得宣稱能保護匿名公開 API。
- 不提交實際部署 URL、憑證、登入狀態或私人 Items。測試只能使用合成 ID、假資料並攔截全部 Google 網路請求。
- 網路失敗保留既有本機資料；未知寫入結果不得自動重試，需先讀取核對。已確認寫入成功後的讀取失敗不可再呈現成可重送的新增表單。

## 統一資料來源與更新

- 選擇 cloud 後，連線失敗必須停止寫入，不自動回退 Mock。重新整理保留使用者選擇；切換 Mock 前顯示不同來源的確認。
- 雲端 updateItem 的 changes 只含相對於編輯初始資料的實際變更欄位；不要把整個 LifeItem 送入後端。更新成功後以原 item_id 重新 getItem。
- 新增必須採用後端回傳 item_id；不得自建替代 ID 或 Mock 副本。跨 ID／舊連線的回應不可覆蓋目前資料。
- 雲端 MaintenancePlans 沿用同一 Bridge 及 ItemsStore，在既有定期子項目分頁操作；Mock 保養維持既有格式，不互相轉存。完成保養、歷史、備註、照片仍顯示「尚未支援雲端同步」並停用寫入。
- 不修改既有 localStorage 資料格式或自動遷移紀錄。切換來源只清理畫面快取；共用型別新增欄位需相容舊 Mock 資料。

## 雲端保養計畫

- `src/api/maintenancePlans.ts` 定義 DTO、驗證、欄位白名單及 repository；元件透過 ItemsStore 操作，不建立另一條連線或寫入 localStorage。
- 每筆計畫須核對 item_id／plan_id；延遲回應不得污染其他事項或來源。編輯及啟用切換前先讀取單筆確認所屬事項。
- 一般表單只允許名稱、週期數值與單位、計算模式、基準日期、提醒天數；更新只送實際差異。enabled 僅由啟用／停用 action 改變。
- 日期維持 YYYY-MM-DD，時間戳保留後端格式。雲端 next_due_date 與 last_completed_date 完全由後端管理，不套用 Mock 的天數算法。
- 新增、更新、停用、啟用後皆重新讀取該 item_id 清單。失敗停用計畫寫入、保留草稿及既有清單，需先重新讀取核對。已確認寫入但讀回失敗時關閉表單，避免重複新增。
- 不新增 MaintenanceRecords、Calendar、Drive 或備註雲端操作。提醒天數僅儲存設定，不宣稱已發送通知。
