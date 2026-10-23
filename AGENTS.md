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
- 雲端 MaintenancePlans 沿用同一 Bridge 及 ItemsStore，在既有定期子項目分頁操作；Mock 保養維持既有格式，不互相轉存。完成保養與歷史使用雲端 MaintenanceRecords；獨立 Notes 支援 item 與 plan；事項及已儲存完成紀錄的照片使用私人 Drive。
- 不修改既有 localStorage 資料格式或自動遷移紀錄。切換來源只清理畫面快取；共用型別新增欄位需相容舊 Mock 資料。

## 雲端保養計畫

- `src/api/maintenancePlans.ts` 定義 DTO、驗證、欄位白名單及 repository；元件透過 ItemsStore 操作，不建立另一條連線或寫入 localStorage。
- 每筆計畫須核對 item_id／plan_id；延遲回應不得污染其他事項或來源。編輯及啟用切換前先讀取單筆確認所屬事項。
- 一般表單只允許名稱、週期數值與單位、計算模式、基準日期、提醒天數；更新只送實際差異。enabled 僅由啟用／停用 action 改變。
- 日期維持 YYYY-MM-DD，時間戳保留後端格式。雲端 next_due_date 與 last_completed_date 完全由後端管理，不套用 Mock 的天數算法。
- 新增、更新、停用、啟用後皆重新讀取該 item_id 清單。失敗停用計畫寫入、保留草稿及既有清單，需先重新讀取核對。已確認寫入但讀回失敗時關閉表單，避免重複新增。
- 保養計畫不新增 Calendar 寫入或 Drive 附件操作。Notes 只使用 v3.2 已定義的四個 action。提醒天數僅儲存設定，不宣稱網站已發送通知。

## 雲端完成紀錄

- `src/api/maintenanceRecords.ts` 負責 Bridge action、DTO、內容驗證與 ID／所屬事項檢查。`ItemsStore` 管理歷史載入、寫入後重讀及來源／頁面隔離，畫面不可直接呼叫 Bridge 或 Mock API。
- 每份尚未確認的完成草稿使用一個 `crypto.randomUUID()` record_id，儲存在與 Mock 鍵分開的 sessionStorage。重開表單、重新整理或送出重試沿用同一 ID；成功重讀後才清理草稿。
- 寫入結果不確定時先用 getMaintenanceRecord 查原 ID；查詢失敗時阻擋重送。已查到同內容則當作成功，內容不符或明確衝突則停止重試。duplicate 表示已儲存，不再新增。
- 完成後重讀該事項計畫、該事項歷史及該計畫歷史。後端回傳的 last_completed_date／next_due_date 是唯一可信資料；歷史費用只用已成功載入的雲端 Records，按 record_id 去重。讀取失敗不得顯示假零金額。
- 僅支援完成紀錄新增及查詢；不提供刪除或更正。不得將雲端紀錄寫進 Mock localStorage，不自動上傳 Mock 紀錄。

## Google Calendar 同步狀態

- 私人日曆同步 Apps Script 不公開為 Web App；前端只能透過既有 Bridge 的唯讀 `getCalendarSyncStatus({ plan_id })` 取得摘要，不讀取或顯示 calendar_id、event_id、授權資訊。
- Web App v3.1 已提供 action，`VITE_CALENDAR_SYNC_STATUS_API_ENABLED` 預設啟用；明確設為 false 時不得發出請求。無時區時間依台北 UTC+08:00 解讀，ISO 時間依明確 offset，禁止直接比較不同時區字串。
- 同步狀態按 item_id 與 plan_id 隔離；切換事項、重新讀取計畫、計畫寫入或完成保養後清理舊狀態並重新讀取。讀取錯誤或計畫更新時間晚於上次同步時間時不得顯示「已同步」。
- 私人 Apps Script 每 15 分鐘定期檢查，並非即時同步；介面僅表示 CalendarSync 紀錄，不能宣稱即時查證事件。前端不提供日曆寫入或手動同步。

## 雲端 Notes v3.2

- `src/api/cloudNotes.ts` 只透過既有 Bridge 呼叫 getNotes/getNote/createNote/updateNote；依 owner_type 與 owner_id 隔離 item 和 plan，禁止提交私人 Web App URL 或 ID。
- 新增草稿使用與 Mock 分開的 sessionStorage 及穩定 UUID；重試先以 getNote 查詢原 ID，衝突時停止。寫入後重讀清單，失敗保留草稿，不顯示成功。
- 不提供封存或刪除 Notes；Mock 紀錄不自動上傳，雲端資料不寫進 Mock localStorage。模擬 Bridge 測試不代表正式 Google Sheets 讀寫已驗證。

## 私人 Google Drive 第一階段

- OAuth 僅使用 Google Identity Services Token Client 與 drive.file scope；Client ID 從 GitHub Actions Variable 進入 Vite 建置，未設定時顯示未設定。
- Access Token 僅保留在記憶體；不透過 Apps Script Bridge，不寫入 localStorage 或原有 Mock 照片資料。Drive API 以授權 Token 讀寫私人事項照片；縮圖使用短暫 Blob URL，不使用公開連結。
- 模擬授權與 Drive API 測試不得宣稱正式 Google 帳號操作成功；事項與已儲存完成紀錄的照片可上傳、更換或移入垃圾桶，不提供公開分享。

## 私人 Google Drive 事項照片

- 專用根資料夾與 item_id 子資料夾必須先查詢及驗證快取再建立；附件 appProperties 必須包含 attachment_id、owner_type=item、owner_id。
- JPG、PNG、WebP 需檢查 MIME、檔案內容與 10 MB 上限。10 MB 上傳使用 Drive 續傳工作階段，XHR 只用於回報進度；未知結果保留相同 attachment_id，核對前禁止重新送出。
- 私人照片透過授權 Drive API 讀取並用 Blob URL 預覽，切換事項或卸載元件時釋放。不得使用公開分享連結、Apps Script Bridge、Mock 照片資料或把 Token 寫入儲存空間。
- 刪除前必須重新讀取檔案 metadata，核對 file ID、attachment_id、owner_type=item、owner_id；只以 PATCH trashed=true 移入垃圾桶。更換時先上傳並讀回新照片，再移入舊照片垃圾桶；部分完成或未知結果須保留新照片及原附件識別碼供重試，不得宣稱完整成功。

## 私人 Google Drive 完成紀錄照片

- 沿用同一 Drive Adapter 與 UI；紀錄照片的 `owner_type=record`、`owner_id=record_id`、`attachment_id=UUID`。資料夾及待送指紋按 owner 型別與 ID 隔離，禁止混入事項照片或其他紀錄。
- 僅向已從 Sheets 載入的完成紀錄顯示入口；每次上傳、更換或移入垃圾桶前以 `getMaintenanceRecord` 確認 record_id 仍存在且 item_id 為目前事項。Drive 檔案操作前重新核對 file ID、owner_type、owner_id、attachment_id；不使用公開 Apps Script 執行 Drive 操作。
- 不修改 Sheets Attachments 工作表、Apps Script、Mock 照片資料或 OAuth 設定；不提交私人照片或 Token。模擬測試不代表正式 Drive 操作驗證。

## 私人 Google Drive PDF 文件

- 沿用 `src/api/drivePhotos.ts` 的 Drive 授權、擁有者資料夾、附件 UUID、metadata 核對及垃圾桶操作；PDF 與照片按 MIME 分開顯示。PDF 僅接受 `application/pdf`、`%PDF-` 標頭與 20 MB 上限。
- 事項及完成紀錄的 PDF 上傳、刪除前分別透過 ItemsStore 核對已儲存的 item_id 或 record_id；不同 owner 的文件不可混用。PDF 預覽與下載只用授權 API 取得 Blob，預覽關閉須釋放 Blob URL，不可建立公開分享連結。
- 大檔使用同一 Drive resumable session，連線中斷先查詢已收位元組再續傳；結果無法確認時保留原 attachment_id 並停止新建。Access Token 僅留記憶體；不修改 Apps Script、Sheets Attachments、Mock 模式或 OAuth scope。
