/** Mã agent (tên file agents/<Mã>.md). 5 agent gốc PM, BE, FE, QA, Tester giữ khung quy trình việc chung; sếp thêm được agent mới */
export type Role = string
export type DevRole = 'BE' | 'FE'
/** Vai trò trong công việc: quyết định quyền khi làm việc thật và trang phục; agent gốc có vai trò trùng mã */
export type Func = 'PM' | 'BE' | 'FE' | 'QA' | 'Tester' | 'Media' | 'Design' | 'Audio' | 'Video' | 'khác'
/** Phòng media: trưởng nhóm, thiết kế đồ hoạ, âm thanh, dựng video */
export const MEDIA_FUNCS: Func[] = ['Media', 'Design', 'Audio', 'Video']
export const CORE_ROLES = ['PM', 'BE', 'FE', 'QA', 'Tester'] as const
export const FUNCS: { id: Func; label: string }[] = [
  { id: 'PM', label: 'Quản lý dự án (đọc, viết tài liệu)' },
  { id: 'BE', label: 'Dev backend (sửa code, chạy lệnh)' },
  { id: 'FE', label: 'Dev frontend (sửa code, chạy lệnh)' },
  { id: 'QA', label: 'QA review (chỉ đọc)' },
  { id: 'Tester', label: 'Tester (sửa test, chạy lệnh)' },
  { id: 'Media', label: '🎬 Trưởng nhóm Media (kịch bản, phân việc, duyệt)' },
  { id: 'Design', label: '🎨 Media · Thiết kế đồ hoạ (ảnh, banner, cảnh)' },
  { id: 'Audio', label: '🎧 Media · Âm thanh (lồng tiếng, nhạc nền)' },
  { id: 'Video', label: '🎞 Media · Dựng video (ghép cảnh, xuất mp4)' },
  { id: 'khác', label: 'Khác (chỉ đọc)' },
]
/** Tối đa số agent: dãy khoang dọc tường sau chỉ đủ chỗ cho chừng này người */
export const MAX_AGENTS = 12

export type Hobby = 'read' | 'game' | 'music' | 'movie' | 'rubik'

export interface AgentDef {
  id: Role
  /** Agent gốc (không xoá được) */
  core: boolean
  func: Func
  name: string
  title: string
  color: string
  /** Vị trí ghế ngồi [x, z] */
  seat: [number, number]
  /** Làm gì khi rảnh việc */
  hobby: Hobby
  /** Nhân vật 3D (dòng `nhân_vật:`) */
  body?: 'nam' | 'nữ'
}

export const HOBBIES: Record<Hobby, { emoji: string; label: string; murmurs: string[] }> = {
  read: { emoji: '📖', label: 'đọc sách', murmurs: ['Chương này hay ghê 📖', 'Sắp tới đoạn plot twist rồi...', 'Đọc thêm một trang nữa thôi'] },
  game: { emoji: '🎮', label: 'chơi game', murmurs: ['Ván này căng quá 🎮', 'Combo đẹp! 😎', 'Thua rồi, làm ván nữa!'] },
  music: { emoji: '🎧', label: 'nghe nhạc', murmurs: ['♪ Bài này nghe cuốn thật', '♫ La la la~', 'Playlist hôm nay chill ghê 🎧'] },
  movie: { emoji: '🍿', label: 'xem phim', murmurs: ['Phim đến đoạn gay cấn 🍿', 'Ơ, đừng mở cánh cửa đó!', 'Tập này hay quá trời'] },
  rubik: { emoji: '🧩', label: 'xoay rubik', murmurs: ['Còn một mặt nữa thôi 🧩', 'Kỷ lục mới: 1 phút 20!', 'Công thức này lạ ghê...'] },
}

// Bố cục phòng: dãy khoang ngồi dọc tường sau, lối đi chạy phía trước khoang
export const DESK_Z = -2.6
export const SEAT_Z = -1.7
export const AISLE_Z = -0.9
export const CUBICLE_WIDTH_MAX = 2.8
/** Bề rộng dãy khoang (tường trái x=-8, chừa 0.4 mỗi bên) */
const ROW_WIDTH = 15.2
/** Bề rộng một khoang: 2.8 khi có tối đa 5 người, hẹp lại khi đông hơn */
export let CUBICLE_WIDTH = CUBICLE_WIDTH_MAX
export const CUBICLE_FRONT_Z = -1.25 // vách ngăn kết thúc ở đây, trước lối đi

export const AGENTS: AgentDef[] = [
  { id: 'PM', core: true, func: 'PM', name: 'Lan', title: 'Project Manager', color: '#3b82f6', seat: [-5.6, SEAT_Z], hobby: 'read', body: 'nữ' },
  { id: 'BE', core: true, func: 'BE', name: 'Minh', title: 'Backend Developer', color: '#22c55e', seat: [-2.8, SEAT_Z], hobby: 'game' },
  { id: 'FE', core: true, func: 'FE', name: 'Khoa', title: 'Frontend Developer', color: '#14b8a6', seat: [0, SEAT_Z], hobby: 'music' },
  { id: 'QA', core: true, func: 'QA', name: 'Hà', title: 'QA Engineer', color: '#f97316', seat: [2.8, SEAT_Z], hobby: 'movie', body: 'nữ' },
  { id: 'Tester', core: true, func: 'Tester', name: 'Tú', title: 'Tester', color: '#a855f7', seat: [5.6, SEAT_Z], hobby: 'rubik' },
]

/** Agent không còn trong danh sách (vừa bị xoá) vẫn trả về một hồ sơ tạm để giao diện không vỡ */
export const agentById = (id: Role): AgentDef =>
  AGENTS.find((a) => a.id === id) ?? { id, core: false, func: 'khác', name: id, title: '', color: '#94a3b8', seat: [0, SEAT_Z], hobby: 'music' }

/** Sở thích ghi trong file (vd "đọc sách") → loại sở thích có hoạt cảnh; không khớp thì chọn theo mã agent */
export function hobbyFrom(text: string | undefined, id: Role): Hobby {
  const t = (text ?? '').toLowerCase()
  const hit = (Object.keys(HOBBIES) as Hobby[]).find((h) => t.includes(HOBBIES[h].label) || t === h)
  if (hit) return hit
  const keys = Object.keys(HOBBIES) as Hobby[]
  return keys[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % keys.length]
}

/** Phòng media bên phải văn phòng (x 8 → 14), cửa kính mở ra lối đi chung */
export const MEDIA_ROOM = { x0: 8, x1: 17, z0: -3.5, z1: 3, doorZ: [AISLE_Z - 0.65, AISLE_Z + 0.65] as [number, number] }
export const inMediaRoom = (a: AgentDef) => MEDIA_FUNCS.includes(a.func)
/** Hai tầng: 0 = văn phòng dev, 1 = phòng media (tầng 2). Vẫn chung hệ toạ độ, cửa phòng media ở x0 là lối lên tầng */
export type Floor = 0 | 1
export const FLOORS: { id: Floor; label: string; icon: string }[] = [
  { id: 0, label: 'Tầng 1 · Văn phòng', icon: '🏢' },
  { id: 1, label: 'Tầng 2 · Media', icon: '🎬' },
]
/** Agent đang ở tầng nào theo vị trí x (qua khỏi khung cửa một chút mới tính là sang tầng) */
export const floorAt = (x: number): Floor => (x >= MEDIA_ROOM.x0 + 0.3 ? 1 : 0)
/** Bề rộng một bàn trong phòng media */
export const mediaDeskWidth = () => (MEDIA_ROOM.x1 - MEDIA_ROOM.x0) / Math.max(2, AGENTS.filter(inMediaRoom).length)

/** Xếp lại chỗ ngồi: dãy khoang dọc tường sau văn phòng; agent media ngồi ở phòng media */
export function layoutSeats() {
  const row = AGENTS.filter((a) => !inMediaRoom(a))
  const media = AGENTS.filter(inMediaRoom)
  const n = Math.max(1, row.length)
  CUBICLE_WIDTH = Math.min(CUBICLE_WIDTH_MAX, ROW_WIDTH / n)
  row.forEach((a, i) => (a.seat = [(i - (n - 1) / 2) * CUBICLE_WIDTH, SEAT_Z]))
  const w = mediaDeskWidth()
  media.forEach((a, i) => (a.seat = [MEDIA_ROOM.x0 + w * (i + 0.5), SEAT_Z]))
}

// Góc họp standup phía trước bên phải
export const MEETING_CENTER: [number, number] = [3, 1.6]
const MEETING_RADIUS = 1.0
/** Hành lang dọc hai bên bàn họp, để không ai đi xuyên qua bàn */
export const MEETING_LANE_OFFSET = 1.5

/** Chỗ đứng quanh bàn họp cho agent thứ i */
export function meetingSpot(i: number): [number, number] {
  const a = Math.PI + (i * Math.PI * 2) / AGENTS.length + Math.PI / AGENTS.length
  return [MEETING_CENTER[0] + Math.sin(a) * MEETING_RADIUS, MEETING_CENTER[1] + Math.cos(a) * MEETING_RADIUS]
}
