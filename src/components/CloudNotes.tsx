import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { ItemsStore, NotesSnapshot } from "../api/itemsStore";
import type { CloudNote, NoteOwnerType } from "../api/cloudNotes";

export default function CloudNotes({ ownerType, ownerId, store, state, busy, readOnly }: {
  ownerType: NoteOwnerType; ownerId: string; store: ItemsStore; state: NotesSnapshot;
  busy: boolean; readOnly: boolean;
}) {
  if (state.status === "unavailable") return <div className="empty"><h2>備註雲端 API 尚未連接</h2></div>;
  return <ConnectedCloudNotes key={`${ownerType}:${ownerId}`} {...{ ownerType, ownerId, store, state, busy, readOnly }} />;
}
function ConnectedCloudNotes({ ownerType, ownerId, store, state, busy, readOnly }: {
  ownerType: NoteOwnerType; ownerId: string; store: ItemsStore; state: NotesSnapshot;
  busy: boolean; readOnly: boolean;
}) {
  const [newDraft, setNewDraft] = useState(() => store.openNoteDraft(ownerType, ownerId));
  const [editing, setEditing] = useState<CloudNote | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [localError, setLocalError] = useState("");
  const own = state.ownerType === ownerType && state.ownerId === ownerId;
  useEffect(() => {
    if (!own || state.status === "idle") void store.loadNotes(ownerType, ownerId);
  }, [ownerType, ownerId, own, state.status, store]);
  const ready = own && state.status === "ready";
  const disabled = readOnly || busy || !ready;
  return <>
    <div className="section-heading"><h2>{ownerType === "item" ? "生活筆記" : "保養計畫備註"}</h2></div>
    {own && state.error && <p className="error-banner" role="alert">{state.error}</p>}
    {localError && <p className="error-banner" role="alert">{localError}</p>}
    {own && state.notice && <p role="status">{state.notice}</p>}
    <button className="text-button" disabled={busy || (own && state.status === "loading")}
      onClick={() => void store.loadNotes(ownerType, ownerId)}>重新讀取備註</button>
    {own && state.status === "loading" && <p role="status">正在讀取雲端備註…</p>}
    <form className="note-form" onSubmit={async event => {
      event.preventDefault();
      if (disabled || !newDraft.title.trim() || !newDraft.content.trim()) return;
      setLocalError("");
      try {
        await store.saveNote(newDraft);
        setNewDraft(store.openNoteDraft(ownerType, ownerId));
      } catch (error) { setLocalError((error as Error).message); }
    }}>
      <input aria-label="新增備註標題" required placeholder="備註標題" value={newDraft.title}
        onChange={event => { const next = { ...newDraft, title: event.target.value }; store.saveNoteDraft(next); setNewDraft(next); }} />
      <textarea aria-label="新增備註內容" rows={3} required placeholder="補充需要記住的事情…" value={newDraft.content}
        onChange={event => { const next = { ...newDraft, content: event.target.value }; store.saveNoteDraft(next); setNewDraft(next); }} />
      <button className="primary" disabled={disabled || !newDraft.title.trim() || !newDraft.content.trim()}><Plus size={16} />新增備註</button>
    </form>
    {ready && !state.rows.length && <p className="empty">尚無雲端備註。</p>}
    {ready && state.rows.map(note => <article className="note" key={note.note_id}>
      <h3>{note.title}</h3><p>{note.content}</p><time>{note.created_at}</time>
      <div className="task-actions"><button className="text-button" disabled={disabled} onClick={() => {
        setEditing(note); setEditTitle(note.title); setEditContent(note.content); setLocalError("");
      }}>編輯</button></div>
    </article>)}
    {editing && <form className="note-form" onSubmit={async event => {
      event.preventDefault();
      if (disabled || !editTitle.trim() || !editContent.trim()) return;
      setLocalError("");
      try {
        await store.saveNote({ note_id: editing.note_id, owner_type: ownerType, owner_id: ownerId,
          title: editTitle, content: editContent }, editing);
        setEditing(null);
      } catch (error) { setLocalError((error as Error).message); }
    }}>
      <label>編輯備註標題<input value={editTitle} required onChange={event => setEditTitle(event.target.value)} /></label>
      <label>編輯備註內容<textarea value={editContent} required rows={3} onChange={event => setEditContent(event.target.value)} /></label>
      <button className="primary" disabled={disabled || !editTitle.trim() || !editContent.trim()}>儲存備註</button>
      <button type="button" className="secondary" onClick={() => setEditing(null)}>取消</button>
    </form>}
  </>;
}
