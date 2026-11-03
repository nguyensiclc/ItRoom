import { useEffect, useState } from 'react'
import { agentById } from '../data/agents'

interface QuotaWindow {
  used: number
  resetsAt: number | null
  status: string
}
interface QuotaInfo {
  claude: { fiveHour: QuotaWindow | null; sevenDay: QuotaWindow | null; status: string; updatedAt: number; agents: string[] } | null
  agy: { lastOk: number | null; lastError: { at: number; text: string; quota: boolean } | null; agents: string[] }
}

const left = (w: QuotaWindow | null | undefined) => (w ? Math.max(0, Math.round(100 - w.used)) : null)
const tone = (pct: number | null) => (pct === null ? 'unknown' : pct <= 10 ? 'low' : pct <= 30 ? 'mid' : 'ok')
const at = (ms: number | null | undefined, withDay = false) =>
  ms ? new Date(ms).toLocaleString('vi-VN', withDay ? { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' } : { hour: '2-digit', minute: '2-digit' }) : '—'
const names = (ids: string[]) => ids.map((id) => agentById(id).name).join(', ') || 'không ai'

function Bar({ label, w, day }: { label: string; w: QuotaWindow | null | undefined; day?: boolean }) {
  const pct = left(w)
  return (
    <div className="q-row">
      <div className="q-head">
        <span>{label}</span>
        <b className={`q-${tone(pct)}`}>{pct === null ? '—' : `còn ${pct}%`}</b>
      </div>
      <div className="q-bar">
        <i className={`q-${tone(pct)}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <small>làm mới lúc {at(w?.resetsAt, day)}</small>
    </div>
  )
}

/** Quota còn lại của Claude (5 giờ / 7 ngày) và tình trạng Antigravity, trên thanh trên cùng */
export function QuotaBadge() {
  const [info, setInfo] = useState<QuotaInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async (mode: '' | 'auto' | 'refresh' = '') => {
    try {
      const res = await fetch(`/api/quota${mode ? `?${mode}=1` : ''}`)
      if (res.ok) setInfo((await res.json()) as QuotaInfo)
    } catch {
      // server tắt: giữ số cũ
    }
  }
  useEffect(() => {
    void load('auto') // lần đầu: chưa có số liệu thì hỏi nhanh Claude một lượt
    const t = setInterval(() => void load(), 60_000)
    return () => clearInterval(t)
  }, [])

  const c = info?.claude
  const pct = left(c?.fiveHour)
  const a = info?.agy
  const agyQuotaOut = !!a?.lastError?.quota && (!a.lastOk || a.lastError.at > a.lastOk)

  return (
    <div className="quota">
      <button className={`settings-launch q-pill q-${tone(pct)}`} onClick={() => setOpen((o) => !o)} title="Quota còn lại của Claude và Antigravity">
        ⚡ {pct === null ? '…' : `${pct}%`}
        {agyQuotaOut && <span className="q-warn">agy!</span>}
      </button>
      {open && (
        <div className="panel q-pop">
          <h4>Claude Code</h4>
          {c ? (
            <>
              <Bar label="Phiên 5 giờ" w={c.fiveHour} />
              <Bar label="Tuần (7 ngày)" w={c.sevenDay} day />
              <small className="q-note">
                Cập nhật {at(c.updatedAt)} · dùng chung cho {names(c.agents)}
              </small>
            </>
          ) : (
            <p className="s-hint">Chưa có số liệu.</p>
          )}
          <h4>Antigravity (agy)</h4>
          <p className="s-hint">agy không công bố % quota, chỉ biết lần gọi gần nhất có lỗi hết quota hay không.</p>
          {a && (
            <p className={agyQuotaOut ? 's-error' : 's-ok'}>
              {agyQuotaOut
                ? `⚠️ Hết quota lúc ${at(a.lastError!.at)}`
                : a.lastOk
                  ? `✅ Vẫn gọi được (lần cuối ${at(a.lastOk)})`
                  : a.lastError
                    ? `⚠️ Lỗi lúc ${at(a.lastError.at)}: ${a.lastError.text}`
                    : 'Chưa gọi lần nào từ khi bật server'}
            </p>
          )}
          {a && <small className="q-note">Agent dùng agy: {names(a.agents)}</small>}
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await load('refresh')
              setBusy(false)
            }}
          >
            {busy ? 'Đang hỏi...' : 'Làm mới'}
          </button>
        </div>
      )}
    </div>
  )
}
