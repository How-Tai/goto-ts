// Render the real page components and exercise their event handlers with fixture queries.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..'), req = createRequire(root + '/apps/web/package.json')
const React = req('react'), { renderToString } = req('react-dom/server'), ts = req('typescript')
const realTable = req('@tanstack/react-table')
let role = 'user', viewerId = 1, tab = 'passed', state = 'success', mutationStatus = 200, table, lastOptions
const handlers = new Map(), toasts = [], invalidations = []
const profile = { id: 1, username: 'Fixture', showName: 'Fixture <script>', role: 'user', rating: 1200, showInLeaderboard: true, userContest: [] }
const rows = [{ ...profile, passedCount: 2, rank: 1 }]
const key = name => Object.assign(args => ({ queryKey: ['user', name, args] }), { _def: ['user', name] })
const userKey = Object.fromEntries(['getLeaderboard', 'getPassedProblems', 'getUserProfile'].map(name => [name, key(name)]))
function load(relative) {
  const file = path.join(root, relative), module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  function mock(name) {
    if (name.endsWith('/user-context')) return { useUserContext: () => ({ user: role ? { id: viewerId, role } : null, isAdmin: role === 'admin' }) }
    if (name === 'next/router') return { useRouter: () => ({ query: { tab }, pathname: '/user/[userId]', push() {} }) }
    if (name === 'next/link') return { __esModule: true, default: ({ href, children }) => React.createElement('a', { href }, children) }
    if (name === 'next/head') return { __esModule: true, default: () => null }
    if (name === 'react-hot-toast') return { __esModule: true, default: Object.fromEntries(['success','error'].map(type => [type, message => toasts.push(type)])) }
    if (name.endsWith('/api/server')) return { withQuery: fn => fn }
    if (name.endsWith('/api/query')) return { userKey, userQuery: { updateLeaderboardVisibility: { useMutation: () => ({ isPending: false, mutateAsync: async () => ({ status: mutationStatus, body: { showInLeaderboard: false } }) }) } } }
    if (name === '@tanstack/react-query') return {
      useQueryClient: () => ({ invalidateQueries: async options => invalidations.push(options.queryKey) }),
      useInfiniteQuery: () => ({ data: null }),
      useQuery: options => {
        lastOptions = options
        const leaderboard = options.queryKey.includes('getLeaderboard')
        return { isLoading: state === 'loading', isFetching: false, isError: state === 'error', data: state === 'success' ? { status: 200, body: leaderboard ? { data: rows, total: 1 } : [{ id: 123, name: 'Solved <script>', score: 100, show: true, solvedDate: '2026-11-01T00:00:00Z', submissionId: 12 }] } : undefined }
      },
    }
    if (name === '@tanstack/react-table') return { ...realTable, useReactTable: options => { table = realTable.useReactTable(options); return table } }
    if (name.endsWith('/table-component')) return {
      TableSearch: () => null, TablePagination: () => null, TablePaginationInfo: () => null,
      TableComponent: ({ table, isLoading, isError }) => React.createElement('div', {}, isLoading ? 'Loading fixture' : isError ? 'Error fixture' : table.getRowModel().rows.map(row => React.createElement('div', { key: row.id }, row.getVisibleCells().map(cell => React.createElement('span', { key: cell.id }, realTable.flexRender(cell.column.columnDef.cell, cell.getContext())))))),
    }
    if (name.endsWith('/submission-dialog')) return { SubmissionDialog: ({ children }) => React.createElement('div', { 'data-dialog': true }, children) }
    if (name.endsWith('/submission-table')) return { SubmissionTable: () => null }
    if (name.endsWith('/user-avatar')) return { UserAvatar: () => null }
    if (name.endsWith('/avatar-upload')) return { AvatarUpload: () => null }
    if (name === '@otog/ui/utils') return { clsx: (...items) => items.filter(Boolean).join(' ') }
    if (name.startsWith('@otog/ui/')) return new Proxy({}, { get: (_, component) => {
      if (component === 'Switch') return props => { handlers.set(props.id, props); return React.createElement('button', { id: props.id, role: 'switch', 'aria-checked': props.checked }) }
      if (component === 'TabsContent') return ({ value, children }) => value === tab ? React.createElement('div', {}, children) : null
      return ({ children, ...props }) => React.createElement(component === 'Link' ? 'span' : 'div', {}, children)
    } })
    if (name === '@otog/contract') return {}
    return req(name)
  }
  new Function('require', 'module', 'exports', code)(mock, module, module.exports)
  return module.exports
}
const Leaderboard = load('apps/web/src/pages/leaderboard.tsx').default
const Profile = load('apps/web/src/pages/user/[userId].tsx').default
const render = Component => renderToString(React.createElement(Component, Component === Profile ? { userProfile: profile } : {}))
async function main() {
  const checks = []
  let html = render(Leaderboard)
  assert(html.includes('Fixture &lt;script&gt;')); assert(html.includes('/user/1?tab=passed'))
  assert(!handlers.has('show-hidden-users')); checks.push('real leaderboard columns, escaped names and solved-profile links')
  const publicOptions = lastOptions
  role = 'admin'; render(Leaderboard)
  assert(handlers.has('show-hidden-users'))
  assert.notDeepEqual(publicOptions.queryKey, lastOptions.queryKey)
  assert.equal(publicOptions.placeholderData({ private: true }, { queryKey: lastOptions.queryKey }), undefined)
  checks.push('admin-only controls and cache separation across viewers')
  role = 'user'; html = render(Profile)
  assert(html.includes('/problem/123')); assert(!html.includes('/api/problem/'))
  assert(html.includes('Solved &lt;script&gt;')); assert(html.includes('data-dialog'))
  assert(handlers.has('show-in-leaderboard')); checks.push('solved tab uses working problem links, safe names and owner dialogs')
  await handlers.get('show-in-leaderboard').onCheckedChange(false)
  assert.deepEqual(toasts, ['success']); assert.equal(invalidations.length, 2)
  mutationStatus = 403
  const originalError = console.error; console.error = () => {}
  try { await handlers.get('show-in-leaderboard').onCheckedChange(false) } finally { console.error = originalError }
  assert.deepEqual(toasts, ['success', 'error']); checks.push('visibility success invalidates data; rejected updates produce error feedback')
  handlers.clear(); role = null; html = render(Profile)
  assert(!handlers.has('show-in-leaderboard')); assert(!html.includes('data-dialog'))
  state = 'loading'; assert(render(Profile).includes('กำลังโหลด'))
  state = 'error'; assert(render(Profile).includes('โหลดรายการข้อที่ผ่านไม่สำเร็จ'))
  checks.push('guest read-only profile and distinct loading/failure states')
  console.log(JSON.stringify({ passed: true, checks, realReactRendering: true }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
