import { useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitImpl } from 'three-stdlib'
import { Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { AGENTS, floorAt, type Floor } from './data/agents'
import { positions } from './sim/motion'
import { useStore } from './store'
import { startWorkflow } from './sim/workflow'
import { Building } from './components/Office'
import { Agent } from './components/Agent'
import { Hud } from './components/Hud'

export default function App() {
  useStore((s) => s.namesVersion) // thêm / xoá agent ở trang cài đặt
  useEffect(() => {
    void startWorkflow()
  }, [])
  // chọn một agent (từ chat, danh sách...) đang ở tầng kia thì chuyển sang tầng đó
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (!s.selected || s.selected === prev.selected || !positions[s.selected]) return
        const f = floorAt(positions[s.selected].x)
        if (f !== s.floor) s.setFloor(f)
      }),
    [],
  )

  return (
    <>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 8, 11.5], fov: 45 }} onPointerMissed={() => useStore.getState().select(null)}>
        <color attach="background" args={['#e6e1d8']} />
        <fog attach="fog" args={['#e6e1d8', 20, 36]} />
        <hemisphereLight args={['#fffaf0', '#b8a58c', 0.55]} />
        <directionalLight
          position={[4, 9, 5]}
          intensity={1.7}
          color="#fff4e0"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
          shadow-camera-left={-10}
          shadow-camera-right={18}
          shadow-camera-top={6}
          shadow-camera-bottom={-6}
        />
        {/* ánh sáng môi trường dựng sẵn (không tải HDR từ mạng): trần sáng + cửa sổ bên trái */}
        <Environment resolution={256} frames={1} environmentIntensity={0.6}>
          <Lightformer intensity={1.5} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[16, 10, 1]} />
          <Lightformer intensity={2} color="#e0f2fe" position={[-9, 2, 0]} rotation-y={Math.PI / 2} scale={[10, 3, 1]} />
          <Lightformer intensity={0.6} color="#fde7c7" position={[9, 2, 0]} rotation-y={-Math.PI / 2} scale={[10, 3, 1]} />
        </Environment>
        <Building />
        <FloorCamera />
        {AGENTS.map((a, i) => (
          <Agent key={a.id} def={a} index={i} />
        ))}
        <OrbitControls makeDefault target={[0, 0.6, 0]} maxPolarAngle={Math.PI / 2.1} minDistance={3} maxDistance={18} enableDamping />
      </Canvas>
      <Hud />
    </>
  )
}

/** Góc nhìn mặc định từng tầng: [vị trí camera, điểm nhìn] */
const VIEWS: Record<Floor, [Vector3, Vector3]> = {
  0: [new Vector3(0, 8, 11.5), new Vector3(0, 0.6, 0)],
  1: [new Vector3(12.5, 6, 8.5), new Vector3(12.5, 0.6, -0.4)],
}

/** Đổi tầng thì lướt camera sang tầng mới (giữ nguyên tự do xoay/zoom sau đó) */
function FloorCamera() {
  const floor = useStore((s) => s.floor)
  const controls = useThree((s) => s.controls) as OrbitImpl | null
  const camera = useThree((s) => s.camera)
  const flying = useRef(false)
  const placed = useRef(false)
  useEffect(() => {
    if (!controls) return
    if (!placed.current) {
      // lần đầu (vd mở thẳng ?tang=2): đặt camera ngay, không lướt
      placed.current = true
      camera.position.copy(VIEWS[floor][0])
      controls.target.copy(VIEWS[floor][1])
      controls.update()
      return
    }
    flying.current = true
  }, [floor, controls, camera])
  useFrame((_, dt) => {
    if (!flying.current || !controls) return
    const [pos, target] = VIEWS[floor]
    const k = 1 - Math.exp(-5 * dt)
    camera.position.lerp(pos, k)
    controls.target.lerp(target, k)
    controls.update()
    if (camera.position.distanceTo(pos) < 0.05 && controls.target.distanceTo(target) < 0.05) flying.current = false
  })
  return null
}
