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

export default defineConfig({
  plugins: [basicAuth(process.env.ITROOM_PASSWORD), react()],
  server: {
    // Cho phép truy cập qua Cloudflare Tunnel
    allowedHosts: ['.trycloudflare.com'],
    // Backend AI (npm run server)
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})
