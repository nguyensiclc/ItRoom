import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
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
      <Canvas shadows camera={{ position: [1.5, 7.5, 10.5], fov: 45 }} onPointerMissed={() => useStore.getState().select(null)}>
        <color attach="background" args={['#dbe4ee']} />
        <hemisphereLight args={['#ffffff', '#94a3b8', 0.9]} />
        <directionalLight
          position={[4, 8, 5]}
          intensity={1.6}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-9}
          shadow-camera-right={9}
          shadow-camera-top={6}
          shadow-camera-bottom={-6}
        />
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
