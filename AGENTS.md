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
