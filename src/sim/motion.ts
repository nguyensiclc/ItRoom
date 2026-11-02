import { Vector3 } from 'three'
import { AGENTS, AISLE_Z, type Role } from '../data/agents'

interface Motion {
  path: Vector3[]
  faceTo?: Vector3
  resolve: () => void
}

// Vị trí thật của từng agent, cập nhật mỗi frame (không đưa vào store để tránh re-render)
export const positions = Object.fromEntries(
  AGENTS.map((a) => [a.id, new Vector3(a.seat[0], 0, a.seat[1])]),
) as Record<Role, Vector3>

// Lộ trình đang chờ thực hiện; component Agent sẽ tiêu thụ trong useFrame
export const motions: Partial<Record<Role, Motion>> = {}

/** Đi lần lượt qua các điểm [x, z]. Resolve khi đến điểm cuối. */
export function walkPath(id: Role, points: [number, number][], faceTo?: [number, number]): Promise<void> {
  return new Promise((resolve) => {
    motions[id] = {
      path: points.map(([x, z]) => new Vector3(x, 0, z)),
      resolve,
      faceTo: faceTo && new Vector3(faceTo[0], 0, faceTo[1]),
    }
  })
}

// Ghế đặt ngay chỗ ngồi, lưng ghế quay ra lối đi: vào/ra chỗ ngồi thì đi dọc bên phải ghế rồi bước ngang,
// không đi thẳng xuyên qua lưng ghế
const SEAT_SIDE = 0.5
const isSeat = (x: number, z: number) => AGENTS.some((a) => Math.abs(a.seat[0] - x) < 0.05 && Math.abs(a.seat[1] - z) < 0.05)

/** Các điểm từ vị trí hiện tại của agent ra tới lối đi */
export function toAisle(id: Role): [number, number][] {
  const { x, z } = positions[id]
  return isSeat(x, z) ? [[x + SEAT_SIDE, z], [x + SEAT_SIDE, AISLE_Z]] : [[x, AISLE_Z]]
}

/** Các điểm từ lối đi vào tới điểm [x, z] */
export function fromAisle(x: number, z: number): [number, number][] {
  return isSeat(x, z) ? [[x + SEAT_SIDE, AISLE_Z], [x + SEAT_SIDE, z], [x, z]] : [[x, AISLE_Z], [x, z]]
}

/** Đi ra lối đi, dọc lối đi tới cột đích, rồi vào điểm đích. */
export function walkTo(id: Role, x: number, z: number, faceTo?: [number, number]): Promise<void> {
  return walkPath(id, [...toAisle(id), ...fromAisle(x, z)], faceTo)
}

/** Hướng cần quay mặt tới khi đứng/ngồi yên (vd chủ khoang xoay ghế nhìn khách); Agent đọc rồi xoá */
export const facing: Partial<Record<Role, Vector3>> = {}

/** Quay mặt về phía điểm [x, z] mà không đi */
export function faceTo(id: Role, x: number, z: number) {
  facing[id] = new Vector3(x, 0, z)
}

/** Góc quay hiện tại của từng agent, để ghế xoay theo người ngồi */
export const yaws = Object.fromEntries(AGENTS.map((a) => [a.id, Math.PI])) as Record<Role, number>
