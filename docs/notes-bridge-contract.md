# Notes Bridge 待確認契約

此文件是前端提出的 **建議契約**，不是已部署的 Apps Script API。Web App v3.1 已知功能未包含獨立 Notes action；正式建置的 `VITE_NOTES_API_ENABLED` 保持關閉。後端實作並確認欄位後，需核對此文件與 Adapter，才能開啟。

Notes 工作表／唯讀回傳建議欄位：`note_id`、`item_id`、`note_date`（YYYY-MM-DD）、`text`（1–3000 字）、`status`（`active`／`archived`）、`created_at`、`updated_at`。`note_id` 由前端產生 UUID，後端須對同 ID 的重試去重；既有本機 `Note` 型別不直接寫入試算表。

| action | payload | 回傳 |
| --- | --- | --- |
| `getNotes` | `{ item_id }` | `CloudNote[]`，含封存資料 |
| `getNote` | `{ note_id }` | `CloudNote \| null` |
| `createNote` | `{ note_id, item_id, note_date, text }` | `{ success: true, note_id }` |
| `updateNote` | `{ note_id, changes: { text } }` | `{ success: true, note_id }` |
| `archiveNote` | `{ note_id }` | `{ success: true, note_id }` |

前端僅由既有 iframe Bridge 呼叫以上 action；不新增 Web App URL，不直接存取 Sheets。讀取時嚴格核對 `item_id`，寫入時核對 `note_id`；失敗保留草稿與本機 Mock 紀錄，不顯示假成功。雲端新增備註的待送草稿放在獨立 sessionStorage 鍵，重試沿用同一 UUID。後端若使用其他欄位或 action 名稱，必須先修改 Adapter 與測試，再考慮啟用。
