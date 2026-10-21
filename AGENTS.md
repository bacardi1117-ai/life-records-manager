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

- Google Sheets Items 使用獨立 Adapter、DTO、狀態與頁面。原有 LifeItem／Mock API 不可當成已同步雲端資料；禁止自動上傳示範資料。
- 透過 iframe + postMessage，禁止以 fetch 直接呼叫 Apps Script。前端 action 使用 getItems/getItem/createItem/updateItem/archiveItem/restoreItem，而非 bridge 函式名稱。
- getItems 嚴格解析直接陣列，日期欄位為 item_date；status 使用 active/archived。只傳送明確允許的基本欄位，禁止把本機歷史、圖片等附帶上傳。
- 保持「只有我自己」部署權限；本工作範圍不修改 Apps Script。實際 iframe 登入、跨網站限制與後端 ACTIONS 呼叫問題必須另行驗證。
- token 與來源檢查不是使用者驗證，不得宣稱能保護匿名公開 API。
- 不提交實際部署 URL、憑證、登入狀態或私人 Items。測試只能使用合成 ID、假資料並攔截全部 Google 網路請求。
- 網路失敗保留既有本機資料；未知寫入結果不得自動重試，需先讀取核對。已確認寫入成功後的讀取失敗不可再呈現成可重送的新增表單。
