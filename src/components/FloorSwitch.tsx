import { useEffect, useState } from 'react'
import { AGENTS, FLOORS, floorAt } from '../data/agents'
import { useStore } from '../store'
import { positions } from '../sim/motion'

/** Nút chuyển tầng, kèm số người đang có mặt ở mỗi tầng (agent đi cầu thang thì số đổi theo) */
export function FloorSwitch() {
  const floor = useStore((s) => s.floor)
  const setFloor = useStore((s) => s.setFloor)
  const [count, setCount] = useState<[number, number]>([0, 0])
  useEffect(() => {
    const tick = () => {
      const c: [number, number] = [0, 0]
      for (const a of AGENTS) if (positions[a.id]) c[floorAt(positions[a.id].x)]++
      setCount((p) => (p[0] === c[0] && p[1] === c[1] ? p : c))
    }
    tick()
    const t = setInterval(tick, 800)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="floors" role="tablist">
      {FLOORS.map((f) => (
        <button key={f.id} role="tab" aria-selected={floor === f.id} className={floor === f.id ? 'on' : ''} onClick={() => setFloor(f.id)} title={`Xem ${f.label}`}>
          {f.icon} <em>{f.label}</em> <span>{count[f.id]}</span>
        </button>
      ))}
    </div>
  )
}
