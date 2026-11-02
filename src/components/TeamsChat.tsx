import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { AGENTS, agentById, type Role } from '../data/agents'
import { useStore } from '../store'
import {
  createGroup,
  deleteGroup,
  fetchChats,
  fetchMessages,
  sendChatMessage,
  updateGroup,
  type ChatMessage,
  type ChatSummary,
} from '../sim/ai'

const SEEN_KEY = 'itroom.chatSeen'

function loadSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

/** Danh sách cuộc chat (hỏi server định kỳ) và số tin sếp đã xem ở từng cuộc chat (lưu trong trình duyệt) */
const useChats = create<{
  chats: ChatSummary[] | null
  error: string | null
  seen: Record<string, number>
  refresh: () => Promise<void>
  markSeen: (id: string, count: number) => void
}>((set, get) => ({
  chats: null,
  error: null,
  seen: loadSeen(),
  refresh: async () => {
    const { data, error } = await fetchChats()
    set(data ? { chats: data.chats, error: null } : { error: error ?? null })
  },
  markSeen: (id, count) => {
    if (get().seen[id] === count) return
    const seen = { ...get().seen, [id]: count }
    set({ seen })
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
    } catch {
      // không lưu được thì lần sau đếm lại từ đầu
    }
  },
}))

let polling = false
function startChatPolling() {
  if (polling) return
  polling = true
  const tick = async () => {
    await useChats.getState().refresh()
    setTimeout(tick, useStore.getState().chat === undefined ? 4000 : 1500)
  }
  void tick()
}

/** Tin chưa xem: không tính tin của chính sếp và dòng hệ thống ở cuối */
function unreadOf(c: ChatSummary, seen: Record<string, number>) {
  if (!c.last || c.last.from === 'boss') return 0
  return Math.max(0, c.count - (seen[c.id] ?? 0))
}

function Avatar({ role, size = 32 }: { role: Role | 'boss'; size?: number }) {
  const def = role === 'boss' ? null : agentById(role)
  return (
    <span className="t-avatar" style={{ width: size, height: size, fontSize: size * 0.42, background: def?.color ?? '#334155' }}>
      {def ? def.name[0] : 'S'}
    </span>
  )
}

function ChatAvatar({ chat, size = 34 }: { chat: ChatSummary; size?: number }) {
  if (chat.kind === 'dm') return <Avatar role={chat.members[0]} size={size} />
  const shown = chat.members.slice(0, 2)
  return (
    <span className="t-group-avatar" style={{ width: size, height: size }}>
      {shown.map((r) => (
        <Avatar key={r} role={r} size={size * 0.62} />
      ))}
      {chat.members.length > 2 && <i>+{chat.members.length - 2}</i>}
    </span>
  )
}

const nameOf = (r: Role) => agentById(r).name

function typingText(roles: Role[]) {
  if (!roles.length) return null
  return `${roles.map(nameOf).join(', ')} đang soạn tin`
}

/** Nút mở cửa sổ chat, có số tin chưa xem */
export function ChatLauncher() {
  const chats = useChats((s) => s.chats)
  const seen = useChats((s) => s.seen)
  const open = useStore((s) => s.chat !== undefined)
  const openChat = useStore((s) => s.openChat)
  useEffect(startChatPolling, [])
  const unread = (chats ?? []).reduce((n, c) => n + unreadOf(c, seen), 0)
  return (
    <button className={`chat-launch ${open ? 'on' : ''}`} onClick={() => openChat(open ? undefined : null)} title="Chat với từng người hoặc theo nhóm">
      💬 Chat{unread > 0 && <b>{unread}</b>}
    </button>
  )
}

function GroupForm({ initial, onDone }: { initial?: ChatSummary; onDone: (id?: string) => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [members, setMembers] = useState<Role[]>(initial?.members ?? [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toggle = (r: Role) => setMembers((m) => (m.includes(r) ? m.filter((x) => x !== r) : [...m, r]))

  return (
    <form
      className="t-form"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const res = initial
          ? await updateGroup(initial.id.slice(6), { name: name.trim(), members })
          : await createGroup(name.trim(), members)
        setBusy(false)
        if (res.error) return setError(res.error)
        await useChats.getState().refresh()
        onDone(res.data ? `group:${res.data.id}` : undefined)
      }}
    >
      <h4>{initial ? 'Sửa nhóm' : 'Tạo nhóm mới'}</h4>
      <label>
        Tên nhóm
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="vd: Team Backend, Họp release..." maxLength={40} />
      </label>
      <span className="t-label">Thành viên</span>
      <div className="t-pick">
        {AGENTS.map((a) => (
          <button
            type="button"
            key={a.id}
            className={members.includes(a.id) ? 'on' : ''}
            style={{ '--c': a.color } as React.CSSProperties}
            onClick={() => toggle(a.id)}
          >
            <Avatar role={a.id} size={22} />
            {a.name}
            <small>{a.id}</small>
          </button>
        ))}
      </div>
      {error && <p className="t-error">{error}</p>}
      <div className="t-actions">
        <button type="button" onClick={() => onDone()}>
          Huỷ
        </button>
        <button className="primary" disabled={busy || !name.trim() || members.length === 0}>
          {initial ? 'Lưu' : 'Tạo nhóm'}
        </button>
      </div>
    </form>
  )
}

function Conversation({ chat }: { chat: ChatSummary }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [typing, setTyping] = useState<Role[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const openChat = useStore((s) => s.openChat)
  const markSeen = useChats((s) => s.markSeen)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const { data, error } = await fetchMessages(chat.id)
      if (!alive) return
      if (data) {
        setMessages(data.messages)
        setTyping(data.typing)
      } else setError(error ?? null)
      timer = setTimeout(tick, 1200)
    }
    void tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [chat.id])

  const count = messages?.length ?? 0
  useEffect(() => {
    if (messages) markSeen(chat.id, chat.count)
  }, [messages, chat.id, chat.count, markSeen])
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [count, typing.length])

  const send = async () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    // hiện ngay tin của sếp, lần hỏi server sau sẽ thay bằng bản thật
    setMessages((m) => [...(m ?? []), { time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }), from: 'boss', text }])
    const res = await sendChatMessage(chat.id, text)
    setError(res.error ?? null)
    if (res.error) setDraft(text)
  }

  const mention = (r: Role) => {
    setDraft((d) => `${d}${d && !d.endsWith(' ') ? ' ' : ''}@${r} `)
    inputRef.current?.focus()
  }

  if (editing) return <GroupForm initial={chat} onDone={() => setEditing(false)} />

  const sub =
    chat.kind === 'dm' ? `${agentById(chat.members[0]).title} · @${chat.members[0]}` : `${chat.members.length + 1} người: Bạn, ${chat.members.map(nameOf).join(', ')}`

  return (
    <>
      <header className="t-head">
        <button className="t-back" onClick={() => openChat(null)} aria-label="Quay lại">
          ‹
        </button>
        <ChatAvatar chat={chat} size={36} />
        <div>
          <strong>{chat.name}</strong>
          <small>{sub}</small>
        </div>
        {chat.kind === 'group' && (
          <>
            <button className="t-ghost" onClick={() => setEditing(true)}>
              👥 Thành viên
            </button>
            <button
              className="t-ghost danger"
              onClick={async () => {
                if (!window.confirm(`Xoá nhóm "${chat.name}"? Tin nhắn vẫn giữ trong office/chat.`)) return
                await deleteGroup(chat.id.slice(6))
                await useChats.getState().refresh()
                openChat(null)
              }}
            >
              Xoá
            </button>
          </>
        )}
      </header>

      <div className="t-messages" ref={listRef}>
        {messages === null && <p className="t-empty">Đang tải...</p>}
        {messages?.length === 0 && (
          <p className="t-empty">
            {chat.kind === 'dm' ? `Bắt đầu trò chuyện với ${chat.name}.` : 'Nhóm chưa có tin nhắn. Gõ @tên để gọi riêng một người, không thì cả nhóm cùng trả lời.'}
          </p>
        )}
        {messages?.map((m, i) => {
          if (m.from === '') return <p key={i} className="t-system">{m.text}</p>
          const prev = messages[i - 1]
          const grouped = prev && prev.from === m.from && prev.time === m.time
          if (m.from === 'boss') {
            return (
              <div key={i} className={`t-msg mine ${grouped ? 'cont' : ''}`}>
                {!grouped && <time>{m.time}</time>}
                <div className="t-bubble">{m.text}</div>
              </div>
            )
          }
          const def = agentById(m.from)
          return (
            <div key={i} className={`t-msg ${grouped ? 'cont' : ''}`}>
              {grouped ? <span className="t-avatar-gap" /> : <Avatar role={m.from} size={30} />}
              <div>
                {!grouped && (
                  <div className="t-meta">
                    <b style={{ color: def.color }}>{def.name}</b> <time>{m.time}</time>
                  </div>
                )}
                <div className="t-bubble">{m.text}</div>
              </div>
            </div>
          )
        })}
        {typing.length > 0 && (
          <div className="t-typing">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            {typingText(typing)}
          </div>
        )}
      </div>

      <form
        className="t-compose"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        {chat.kind === 'group' && (
          <div className="t-mentions">
            Gọi riêng:
            {chat.members.map((r) => (
              <button type="button" key={r} onClick={() => mention(r)} style={{ color: agentById(r).color }}>
                @{nameOf(r)}
              </button>
            ))}
          </div>
        )}
        {error && <p className="t-error">{error}</p>}
        <div className="t-input">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={chat.kind === 'dm' ? `Nhắn cho ${chat.name}` : `Nhắn trong nhóm ${chat.name}`}
          />
          <button className="primary" disabled={!draft.trim()} aria-label="Gửi">
            ➤
          </button>
        </div>
      </form>
    </>
  )
}

/** Cửa sổ chat kiểu Microsoft Teams: chat riêng với từng agent và nhóm chat sếp tự tạo */
export function TeamsChat() {
  const current = useStore((s) => s.chat)
  const openChat = useStore((s) => s.openChat)
  const chats = useChats((s) => s.chats)
  const error = useChats((s) => s.error)
  const seen = useChats((s) => s.seen)
  const [creating, setCreating] = useState(false)
  if (current === undefined) return null

  const active = chats?.find((c) => c.id === current)
  const groupChats = chats?.filter((c) => c.kind === 'group') ?? []
  const dms = chats?.filter((c) => c.kind === 'dm') ?? []

  const row = (c: ChatSummary) => {
    const unread = unreadOf(c, seen)
    const preview = typingText(c.typing) ?? (c.last ? `${c.last.from === 'boss' ? 'Bạn: ' : c.kind === 'group' && c.last.from ? `${nameOf(c.last.from)}: ` : ''}${c.last.text}` : 'Chưa có tin nhắn')
    return (
      <button
        key={c.id}
        className={`t-row ${c.id === current ? 'sel' : ''} ${unread ? 'unread' : ''}`}
        onClick={() => {
          setCreating(false)
          openChat(c.id)
        }}
      >
        <ChatAvatar chat={c} />
        <span className="t-row-main">
          <span className="t-row-top">
            <b>{c.name}</b>
            <time>{c.last?.time}</time>
          </span>
          <span className={`t-row-preview ${c.typing.length ? 'typing' : ''}`}>{preview}</span>
        </span>
        {unread > 0 && <i className="t-badge">{unread}</i>}
      </button>
    )
  }

  return (
    <div className={`panel teams ${current || creating ? 'has-chat' : ''}`}>
      <aside className="t-side">
        <header>
          <h2>Chat</h2>
          <button className="t-ghost" onClick={() => setCreating(true)} title="Tạo nhóm chat mới">
            ＋ Nhóm mới
          </button>
          <button className="t-close" onClick={() => openChat(undefined)} aria-label="Đóng">
            ×
          </button>
        </header>
        <div className="t-list">
          {error && !chats && <p className="t-error">{error}</p>}
          {groupChats.length > 0 && <h5>Nhóm</h5>}
          {groupChats.map(row)}
          <h5>Trò chuyện riêng</h5>
          {dms.map(row)}
        </div>
      </aside>
      <section className="t-main">
        {creating ? (
          <GroupForm
            onDone={(id) => {
              setCreating(false)
              if (id) openChat(id)
            }}
          />
        ) : active ? (
          <Conversation key={active.id} chat={active} />
        ) : (
          <div className="t-placeholder">
            <span>💬</span>
            <p>Chọn một người để nhắn riêng, hoặc tạo nhóm và thêm bất kỳ ai vào cùng trò chuyện.</p>
            <button className="primary" onClick={() => setCreating(true)}>
              ＋ Tạo nhóm
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
