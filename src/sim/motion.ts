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

/** Đi ra lối đi, dọc lối đi tới cột đích, rồi vào điểm đích. */
export function walkTo(id: Role, x: number, z: number, faceTo?: [number, number]): Promise<void> {
  const from = positions[id]
  return walkPath(id, [[from.x, AISLE_Z], [x, AISLE_Z], [x, z]], faceTo)
}
