export type Role = 'PM' | 'BE' | 'FE' | 'QA' | 'Tester'
export type DevRole = 'BE' | 'FE'

export type Hobby = 'read' | 'game' | 'music' | 'movie' | 'rubik'

export interface AgentDef {
  id: Role
  name: string
  title: string
  color: string
  /** Vị trí ghế ngồi [x, z] */
  seat: [number, number]
  /** Làm gì khi rảnh việc */
  hobby: Hobby
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
export const CUBICLE_WIDTH = 2.8
export const CUBICLE_FRONT_Z = -1.25 // vách ngăn kết thúc ở đây, trước lối đi

export const AGENTS: AgentDef[] = [
  { id: 'PM', name: 'Lan', title: 'Project Manager', color: '#3b82f6', seat: [-5.6, SEAT_Z], hobby: 'read' },
  { id: 'BE', name: 'Minh', title: 'Backend Developer', color: '#22c55e', seat: [-2.8, SEAT_Z], hobby: 'game' },
  { id: 'FE', name: 'Khoa', title: 'Frontend Developer', color: '#14b8a6', seat: [0, SEAT_Z], hobby: 'music' },
  { id: 'QA', name: 'Hà', title: 'QA Engineer', color: '#f97316', seat: [2.8, SEAT_Z], hobby: 'movie' },
  { id: 'Tester', name: 'Tú', title: 'Tester', color: '#a855f7', seat: [5.6, SEAT_Z], hobby: 'rubik' },
]

export const agentById = (id: Role) => AGENTS.find((a) => a.id === id)!

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
