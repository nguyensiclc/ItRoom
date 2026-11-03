import { Vector3 } from 'three'
import { AGENTS, MEDIA_FUNCS, hobbyFrom, layoutSeats, type AgentDef, type Func, type Role } from '../data/agents'
import { useStore } from '../store'
import { motions, positions, yaws } from './motion'

/** Một agent theo server (agents/<Mã>.md) */
export interface RosterEntry {
  id: Role
  core: boolean
  func: Func
  name: string
  title?: string
  color?: string
  hobby?: string
  body?: 'nam' | 'nữ'
}

const near = (v: Vector3, seat: [number, number]) => Math.abs(v.x - seat[0]) < 0.05 && Math.abs(v.z - seat[1]) < 0.05

/**
 * Cập nhật danh sách AGENTS dùng chung theo server: đổi tên / màu, thêm agent mới, bỏ agent đã xoá.
 * Có người vào / ra thì xếp lại khoang; ai đang ngồi yên ở ghế cũ thì chuyển sang ghế mới.
 */
export function applyRoster(list: RosterEntry[]) {
  if (!list.length) return
  let changed = false
  const oldSeats = new Map(AGENTS.map((a) => [a.id, a.seat]))
  const oldFuncs = new Map(AGENTS.map((a) => [a.id, a.func]))
  const next: AgentDef[] = list.map((r) => {
    const cur = AGENTS.find((a) => a.id === r.id)
    const def: AgentDef = cur ?? { id: r.id, core: r.core, func: r.func, name: r.name, title: '', color: '#94a3b8', seat: [0, 0], hobby: 'music' }
    const patch: Partial<AgentDef> = {
      core: r.core,
      func: r.func,
      name: r.name,
      title: r.title || def.title,
      color: r.color && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : def.color,
      hobby: r.hobby ? hobbyFrom(r.hobby, r.id) : def.hobby,
      body: r.body ?? def.body ?? 'nam',
    }
    for (const [k, v] of Object.entries(patch) as [keyof AgentDef, never][]) {
      if (def[k] !== v) {
        ;(def as unknown as Record<string, unknown>)[k] = v
        changed = true
      }
    }
    if (!cur) changed = true
    return def
  })
  const sameIds = next.length === AGENTS.length && next.every((a, i) => AGENTS[i].id === a.id)
  // đổi vai trò sang / khỏi Media thì phải xếp lại chỗ ngồi (chuyển phòng)
  const media = (f: Func | undefined) => !!f && MEDIA_FUNCS.includes(f)
  const roomChanged = next.some((a) => oldFuncs.has(a.id) && media(oldFuncs.get(a.id)) !== media(a.func))
  if (!sameIds || roomChanged) {
    changed = true
    AGENTS.splice(0, AGENTS.length, ...next)
    layoutSeats()
    const store = useStore.getState()
    for (const a of AGENTS) {
      const pos = positions[a.id]
      const old = oldSeats.get(a.id)
      if (!pos) positions[a.id] = new Vector3(a.seat[0], 0, a.seat[1])
      else if (old && near(pos, old) && !motions[a.id]) pos.set(a.seat[0], 0, a.seat[1])
      yaws[a.id] ??= Math.PI
      store.ensureAgent(a.id)
    }
  }
  if (changed) useStore.getState().bumpNames()
}

export async function refreshRoster() {
  try {
    const res = await fetch('/api/roster')
    if (res.ok) applyRoster(((await res.json()) as { agents: RosterEntry[] }).agents)
  } catch {
    // server chưa chạy: giữ 5 agent mặc định
  }
}

/** Lấy danh sách agent lúc mở trang và định kỳ (phòng khi sửa tay file .md) */
export function startRosterPolling() {
  const poll = async () => {
    await refreshRoster()
    setTimeout(poll, 15_000)
  }
  void poll()
}
