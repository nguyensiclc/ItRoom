import { useProgress } from '@react-three/drei'

/** Thanh tải mô hình nhân vật (file VRoid ~15 MB mỗi cô): hiện khi đang tải, tải xong thì ẩn */
export function LoadingBar() {
  const { active, progress } = useProgress()
  if (!active) return null
  return (
    <div className="panel loading-bar">
      <span>Đang tải nhân vật… {Math.round(progress)}%</span>
      <i style={{ width: `${progress}%` }} />
    </div>
  )
}
