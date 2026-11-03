import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Đặt ITROOM_PASSWORD để bật đăng nhập (Basic Auth) khi mở web ra internet.
// User: bất kỳ, mật khẩu: giá trị ITROOM_PASSWORD. Không đặt thì không yêu cầu đăng nhập.
function basicAuth(password: string | undefined): Plugin {
  return {
    name: 'itroom-basic-auth',
    configureServer(server) {
      if (!password) return
      server.middlewares.use((req, res, next) => {
        const header = req.headers.authorization ?? ''
        const [scheme, encoded] = header.split(' ')
        if (scheme === 'Basic' && encoded) {
          const decoded = Buffer.from(encoded, 'base64').toString()
          const pass = decoded.slice(decoded.indexOf(':') + 1)
          if (pass === password) return next()
        }
        res.statusCode = 401
        res.setHeader('WWW-Authenticate', 'Basic realm="IT Room"')
        res.end('Unauthorized')
      })
    },
  }
}

// Mô hình nhân vật (~15 MB mỗi file VRoid): mặc định Vite trả `no-cache` nên F5 nào cũng tải lại cả trăm MB.
// Cho trình duyệt nhớ 7 ngày; thay file cùng tên thì Ctrl+F5 để tải lại.
function cacheModels(): Plugin {
  return {
    name: 'itroom-cache-models',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (/^\/models\/[^?]+\.(vrm|glb|gltf|fbx)(\?|$)/i.test(req.url ?? '')) {
          if (/\.vrm(\?|$)/i.test(req.url ?? '')) res.setHeader('Content-Type', 'model/gltf-binary')
          const setHeader = res.setHeader.bind(res)
          // sirv (phục vụ thư mục public) ghi đè Cache-Control thành no-cache: giữ giá trị của mình
          res.setHeader = (name, value) => (name.toLowerCase() === 'cache-control' ? res : setHeader(name, value))
          setHeader('Cache-Control', 'public, max-age=604800')
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [basicAuth(process.env.ITROOM_PASSWORD), cacheModels(), react()],
  server: {
    // Cho phép truy cập qua Cloudflare Tunnel
    allowedHosts: ['.trycloudflare.com'],
    // Backend AI (npm run server)
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})
