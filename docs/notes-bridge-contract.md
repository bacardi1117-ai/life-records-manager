# Notes Bridge v3.2 前端契約

前端沿用 life-records-v1 iframe + postMessage Bridge 與既有 Web App URL。此文件記錄目前依使用者提供的 Apps Script v3.2 契約所實作的前端欄位；正式 Google Sheets 讀寫仍需在有權限的登入環境另行驗證。

`Note` 的 `note_id`、`owner_type`、`owner_id`、`title`、`content`、`created_at`、`updated_at` 都是字串。`owner_type` 只允許 `item` 或 `plan`。

| action | payload | 回傳 |
| --- | --- | --- |
| `getNotes` | `{ owner_type, owner_id }` | `Note[]` |
| `getNote` | `{ note_id }` | `Note \| null` |
| `createNote` | `{ note_id?, owner_type, owner_id, title, content }` | `{ success, duplicate, note }` |
| `updateNote` | `{ note_id, changes: { title?, content? } }` | `{ success, note }` |

雲端新增一定傳送前端產生的 UUID，重試沿用原 ID；在重新送出前用 `getNote` 查詢是否已寫入，`duplicate` 只接受回傳內容與草稿一致。新增或編輯成功後重新查詢該 owner 的清單，嚴格核對所屬 ID。前端不提供備註封存或實體刪除。Mock 備註與雲端 Notes 分離。
