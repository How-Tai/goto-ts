const http = require('http')

const next = require('next')
const httpProxy = require('next/dist/compiled/http-proxy')

const portFlagIndex = process.argv.findIndex((argument) =>
  ['-p', '--port'].includes(argument)
)
const port = Number(
  process.env.PORT ||
    (portFlagIndex === -1 ? undefined : process.argv[portFlagIndex + 1]) ||
    3000
)

const app = next({ dev: true, hostname: '0.0.0.0', port })
const handleNextRequest = app.getRequestHandler()
const handleNextUpgrade = app.getUpgradeHandler()

app.prepare().then(() => {
  const apiHost = process.env.API_HOST_SSR || 'http://localhost:8000'
  const proxy = httpProxy.createProxyServer({
    target: apiHost,
    changeOrigin: true,
    ws: true,
  })

  proxy.on('error', (error, _request, response) => {
    console.error('API proxy error:', error.message)
    if ('writeHead' in response) {
      if (!response.headersSent) response.writeHead(502)
      response.end('API proxy unavailable')
    } else {
      response.destroy()
    }
  })

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/backend' || pathname.startsWith('/backend/')) {
      request.url = request.url.replace(/^\/backend(?=\/|\?|$)/, '') || '/'
      return proxy.web(request, response)
    }
    if (pathname === '/socket.io' || pathname.startsWith('/socket.io/')) {
      return proxy.web(request, response)
    }
    return handleNextRequest(request, response)
  })

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/socket.io' || pathname.startsWith('/socket.io/')) {
      return proxy.ws(request, socket, head)
    }
    return handleNextUpgrade(request, socket, head)
  })

  server.listen(port, '0.0.0.0', () => {
    console.log(`> Ready on http://localhost:${port}`)
    console.log(`> Proxying /backend and /socket.io to ${apiHost}`)
  })
})
