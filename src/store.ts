import { create } from 'zustand'
import type { Role } from './data/agents'

/** work: ngồi làm việc · hobby: ngồi chơi khi rảnh · listen: ngồi nghe khách · idle: đứng (họp) */
export type AnimState = 'work' | 'hobby' | 'listen' | 'walk' | 'talk' | 'idle'
export type Stage = 'todo' | 'meeting' | 'dev' | 'review' | 'test' | 'done'

/** Phần việc của task: chỉ backend, chỉ frontend, hay cả hai */
export type Area = 'BE' | 'FE' | 'FULLSTACK'

export interface Task {
  id: number
  title: string
  /** Nguyên văn yêu cầu của sếp */
  request: string
  /** 'team' = việc chung (họp rồi cả team làm), hoặc agent được giao đích danh */
  assignee: Role | 'team'
  /** Phần việc (chỉ với việc chung), PM chọn trong cuộc họp */
  area: Area | null
  stage: Stage
  bugs: number
  /** Branch git của việc này trong dự án thật (task/<mã>), mã không trùng giữa các lần tải trang */
  branch: string
}

export interface AgentRuntime {
  state: AnimState
  bubble: string | null
  /** Câu trả lời cho sếp (người dùng), hiện riêng với bong bóng công việc */
  chat: string | null
  taskId: number | null
}

export type Speaker = Role | 'Sếp'

export interface LogEntry {
  id: number
  time: string
  who: Speaker
  text: string
}

interface Store {
  agents: Record<Role, AgentRuntime>
  tasks: Task[]
  log: LogEntry[]
  selected: Role | null
  /** Cửa sổ chat kiểu Teams: undefined = đóng, null = mở chưa chọn cuộc chat, hoặc id (`dm:BE`, `group:<id>`) */
  chat: string | null | undefined
  openChat: (id: string | null | undefined) => void
  speed: number
  /** Người dùng có bật AI không */
  aiEnabled: boolean
  /** Trạng thái thực tế của backend AI */
  aiStatus: 'unknown' | 'online' | 'offline'
  setAi: (patch: Partial<Pick<Store, 'aiEnabled' | 'aiStatus'>>) => void
  setAgent: (id: Role, patch: Partial<AgentRuntime>) => void
  addTask: (request: string, assignee: Role | 'team') => number
  updateTask: (id: number, patch: Partial<Task>) => void
  pushLog: (who: Speaker, text: string) => void
  select: (id: Role | null) => void
  setSpeed: (speed: number) => void
}

const initialAgent = (): AgentRuntime => ({ state: 'hobby', bubble: null, chat: null, taskId: null })

let nextTaskId = 1
let nextLogId = 1

export const useStore = create<Store>((set) => ({
  agents: { PM: initialAgent(), BE: initialAgent(), FE: initialAgent(), QA: initialAgent(), Tester: initialAgent() },
  tasks: [],
  log: [],
  selected: null,
  chat: undefined,
  openChat: (chat) => set({ chat }),
  speed: 1,
  aiEnabled: true,
  aiStatus: 'unknown',
  setAi: (patch) => set(patch),
  setAgent: (id, patch) => set((s) => ({ agents: { ...s.agents, [id]: { ...s.agents[id], ...patch } } })),
  addTask: (request, assignee) => {
    const id = nextTaskId++
    const title = request.length > 40 ? `${request.slice(0, 38)}…` : request // tên tạm, agent đặt lại sau
    set((s) => ({ tasks: [...s.tasks, { id, title, request, assignee, area: null, stage: 'todo', bugs: 0, branch: `task/${Date.now().toString(36)}-${id}` }] }))
    return id
  },
  updateTask: (id, patch) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  pushLog: (who, text) =>
    set((s) => ({
      log: [{ id: nextLogId++, time: new Date().toLocaleTimeString('vi-VN'), who, text }, ...s.log].slice(0, 30),
    })),
  select: (id) => set({ selected: id }),
  setSpeed: (speed) => set({ speed }),
}))
