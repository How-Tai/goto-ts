import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Button } from '@otog/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@otog/ui/dialog'
import { Input } from '@otog/ui/input'
import { client } from '../../api/browser'

export function RejudgeAllDialog() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const queryClient = useQueryClient()
  const close = (next: boolean) => {
    if (busy.current) return
    setPassword(''); setError(''); setOpen(next)
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy.current || !password) return
    busy.current = true; setPending(true); setError('')
    const enteredPassword = password
    setPassword('')
    try {
      // Keep the password out of React Query's retained mutation variables.
      const result = await client.patch({ password: enteredPassword }, '/submission/problem/all/rejudge').json<{ queued: number }>()
      setOpen(false)
      toast.success(`ส่งตรวจใหม่ ${result.queued.toLocaleString()} คำตอบแล้ว`)
      void queryClient.invalidateQueries({ queryKey: ['submission'] })
      void queryClient.invalidateQueries({ queryKey: ['problem'] })
    } catch (failure) {
      const status = (failure as { status?: number }).status
      setError(status === 403 ? 'รหัสผ่านไม่ถูกต้อง หรือบัญชีไม่มีสิทธิ์ผู้ดูแลระบบ'
        : status === 429 || status === 503 ? 'กรุณารอสักครู่แล้วลองใหม่'
        : 'ไม่สามารถส่งตรวจใหม่ได้ กรุณาลองอีกครั้ง')
    } finally {
      busy.current = false; setPending(false)
    }
  }
  return <Dialog open={open} onOpenChange={close}>
    <DialogTrigger asChild><Button variant="outline">ตรวจทุกโจทย์ใหม่</Button></DialogTrigger>
    <DialogContent>
      <DialogTitle>ตรวจทุกโจทย์ใหม่</DialogTitle>
      <DialogDescription>ส่งคำตอบที่ตรวจเสร็จแล้วของทุกโจทย์ รวมถึงในการแข่งขัน ไปตรวจใหม่ คำตอบที่รอหรือตรวจอยู่จะทำงานต่อ</DialogDescription>
      <form className="space-y-4" onSubmit={submit}>
        <label className="block space-y-2" htmlFor="rejudge-admin-password">
          <span>รหัสผ่านบัญชีผู้ดูแลระบบของคุณ</span>
          <Input id="rejudge-admin-password" type="password" autoComplete="current-password" value={password}
            onChange={event => setPassword(event.target.value)} maxLength={255} required disabled={pending} autoFocus />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => close(false)}>ยกเลิก</Button>
          <Button type="submit" variant="destructive" disabled={pending || !password}>{pending ? 'กำลังส่งตรวจใหม่…' : 'ยืนยันตรวจทุกโจทย์ใหม่'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}
