import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { AGENTS } from './data/agents'
import { useStore } from './store'
import { startWorkflow } from './sim/workflow'
import { Office } from './components/Office'
import { Agent } from './components/Agent'
import { Hud } from './components/Hud'

export default function App() {
  useEffect(() => {
    void startWorkflow()
  }, [])

  return (
    <>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [1.5, 7.5, 10.5], fov: 45 }} onPointerMissed={() => useStore.getState().select(null)}>
        <color attach="background" args={['#e6e1d8']} />
        <fog attach="fog" args={['#e6e1d8', 18, 32]} />
        <hemisphereLight args={['#fffaf0', '#b8a58c', 0.55]} />
        <directionalLight
          position={[4, 9, 5]}
          intensity={1.7}
          color="#fff4e0"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
          shadow-camera-left={-9}
          shadow-camera-right={9}
          shadow-camera-top={6}
          shadow-camera-bottom={-6}
        />
        {/* ánh sáng môi trường dựng sẵn (không tải HDR từ mạng): trần sáng + cửa sổ bên trái */}
        <Environment resolution={256} frames={1} environmentIntensity={0.6}>
          <Lightformer intensity={1.5} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[16, 10, 1]} />
          <Lightformer intensity={2} color="#e0f2fe" position={[-9, 2, 0]} rotation-y={Math.PI / 2} scale={[10, 3, 1]} />
          <Lightformer intensity={0.6} color="#fde7c7" position={[9, 2, 0]} rotation-y={-Math.PI / 2} scale={[10, 3, 1]} />
        </Environment>
        <Office />
        {AGENTS.map((a, i) => (
          <Agent key={a.id} def={a} index={i} />
        ))}
        <OrbitControls target={[1.5, 0.6, 0]} maxPolarAngle={Math.PI / 2.1} minDistance={3} maxDistance={16} enableDamping />
      </Canvas>
      <Hud />
    </>
  )
}
