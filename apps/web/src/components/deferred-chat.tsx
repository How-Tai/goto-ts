import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { ChatCircleDotsIcon } from '@phosphor-icons/react'
import { Button } from '@otog/ui/button'
import { useSocketContext } from '../context/socket-context'
import { useUserContext } from '../context/user-context'
import { environment } from '../env'

const ChatPanel = dynamic(() => import('./chat').then(module => module.Chat), {
  ssr: false,
  loading: () => <aside className="fixed bottom-4 right-4 z-30" aria-label="แชท">
    <Button className="rounded-full size-12" variant="outline" disabled aria-busy="true" aria-label="กำลังโหลดแชท">
      <ChatCircleDotsIcon weight="fill" />
    </Button>
  </aside>,
})
let preload: Promise<typeof import('./chat')> | undefined

export function DeferredChat() {
  const { socket } = useSocketContext()
  const { isAuthenticated } = useUserContext()
  const [activated, setActivated] = useState(false)
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(false)
  const focusTrigger = useRef(false)
  // Keep the launcher mounted while preloading so a pointer's first click is preserved.
  const preloadPanel = () => { void (preload ??= import('./chat')).catch(() => { preload = undefined }) }
  useEffect(() => {
    if (!socket || activated) return
    const message = () => setUnread(true)
    socket.on('chat', message)
    return () => { socket.off('chat', message) }
  }, [socket, activated])
  if (environment.OFFLINE_MODE || !isAuthenticated) return null
  if (activated) return <ChatPanel open={open} onOpenChange={value => {
    setOpen(value); if (value) setUnread(false)
  }} initialUnread={unread} focusTrigger={focusTrigger.current} />
  return <aside className="fixed bottom-4 right-4 z-30" aria-label="แชท">
    {unread && <div className="absolute right-1 top-1 size-2 rounded-full bg-orange-500" />}
    <Button className="rounded-full text-2xl text-gray-600 size-12 [&>svg]:size-6"
      variant="outline" size="icon" aria-label="แชท" title="แชท"
      onPointerEnter={preloadPanel}
      onFocus={() => { focusTrigger.current = true; preloadPanel() }}
      onClick={() => { setOpen(true); setUnread(false); setActivated(true) }}>
      <ChatCircleDotsIcon weight="fill" />
    </Button>
  </aside>
}
