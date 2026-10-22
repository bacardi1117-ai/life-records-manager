import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { ItemsStore, NotesSnapshot } from "../api/itemsStore";
import type { CloudNote } from "../api/cloudNotes";

export default function CloudNotes({
  itemId,
  store,
  state,
  busy,
  readOnly,
}: {
  itemId: string;
  store: ItemsStore;
  state: NotesSnapshot;
  busy: boolean;
  readOnly: boolean;
}) {
  if (state.status === "unavailable")
    return (
      <div className="empty">
        <h2>備註雲端 API 尚未連接</h2>
        <p>
          現有本機 Mock 備註仍保存在原資料來源；待 Notes Bridge
          上線後才會開啟雲端操作。
        </p>
      </div>
    );
  return (
    <ConnectedCloudNotes
      itemId={itemId}
      store={store}
      state={state}
      busy={busy}
      readOnly={readOnly}
    />
  );
}
function ConnectedCloudNotes({
  itemId,
  store,
  state,
  busy,
  readOnly,
}: {
  itemId: string;
  store: ItemsStore;
  state: NotesSnapshot;
  busy: boolean;
  readOnly: boolean;
}) {
  const [newDraft, setNewDraft] = useState(() => store.openNoteDraft(itemId));
  const [editing, setEditing] = useState<CloudNote | null>(null);
  const [editText, setEditText] = useState("");
  const [localError, setLocalError] = useState("");
  useEffect(() => {
    if (state.status === "idle") void store.loadNotes(itemId);
  }, [itemId, state.status, store]);
  const ready = state.itemId === itemId && state.status === "ready";
  const disabled = readOnly || busy || !ready;
  return (
    <>
      <div className="section-heading">
        <h2>生活筆記</h2>
      </div>
      {state.error && (
        <p className="error-banner" role="alert">
          {state.error}
        </p>
      )}
      {localError && (
        <p className="error-banner" role="alert">
          {localError}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      <button
        className="text-button"
        disabled={busy || state.status === "loading"}
        onClick={() => void store.loadNotes(itemId)}
      >
        重新讀取備註
      </button>
      {state.status === "loading" && <p role="status">正在讀取雲端備註…</p>}
      <form
        className="note-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (disabled || !newDraft.text.trim()) return;
          setLocalError("");
          try {
            await store.saveNote(
              itemId,
              newDraft.note_id,
              newDraft.note_date,
              newDraft.text,
            );
            setNewDraft(store.openNoteDraft(itemId));
          } catch (error) {
            setLocalError((error as Error).message);
          }
        }}
      >
        <textarea
          aria-label="新增備註"
          rows={3}
          maxLength={3000}
          required
          placeholder="補充保固資訊、師傅的叮嚀，或下次要注意的事…"
          value={newDraft.text}
          onChange={(event) => {
            const next = { ...newDraft, text: event.target.value };
            try {
              store.saveNoteDraft(next);
              setNewDraft(next);
              setLocalError("");
            } catch (error) {
              setLocalError((error as Error).message);
            }
          }}
        />
        <button
          className="primary"
          disabled={disabled || !newDraft.text.trim()}
        >
          <Plus size={16} />
          新增備註
        </button>
      </form>
      {ready && !state.rows.length && (
        <p className="empty">這件事項尚無雲端備註。</p>
      )}
      {ready &&
        state.rows.map((note) => (
          <article className="note" key={note.note_id}>
            <time>{note.note_date}</time>
            <p>{note.text}</p>
            <span className="muted small">
              {note.status === "archived" ? "已封存" : "使用中"}
            </span>
            {note.status === "active" && (
              <div className="task-actions">
                <button
                  className="text-button"
                  disabled={disabled}
                  onClick={() => {
                    setEditing(note);
                    setEditText(note.text);
                    setLocalError("");
                  }}
                >
                  編輯
                </button>
                <button
                  className="text-button"
                  disabled={disabled}
                  onClick={() => {
                    void store
                      .archiveNote(itemId, note.note_id)
                      .catch((error) =>
                        setLocalError((error as Error).message),
                      );
                  }}
                >
                  封存
                </button>
              </div>
            )}
          </article>
        ))}
      {editing && (
        <form
          className="note-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (disabled || !editText.trim()) return;
            setLocalError("");
            try {
              await store.saveNote(
                itemId,
                editing.note_id,
                editing.note_date,
                editText,
                editing,
              );
              setEditing(null);
            } catch (error) {
              setLocalError((error as Error).message);
            }
          }}
        >
          <label>
            編輯備註
            <textarea
              value={editText}
              maxLength={3000}
              required
              rows={3}
              onChange={(event) => setEditText(event.target.value)}
            />
          </label>
          <button className="primary" disabled={disabled || !editText.trim()}>
            儲存備註
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setEditing(null)}
          >
            取消
          </button>
        </form>
      )}
    </>
  );
}
