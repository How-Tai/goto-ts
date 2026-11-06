import { useState } from 'react'
import toast from 'react-hot-toast'
import { KeywordFailureSchema } from '@otog/contract'
import type { z } from 'zod'
import { Button } from '@otog/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@otog/ui/dialog'

export function useKeywordCheck() {
  const [failure, setFailure] = useState<z.infer<typeof KeywordFailureSchema> | null>(null)
  const handleError = (error: unknown, toastId: string) => {
    if (error && typeof error === 'object' && 'status' in error && error.status === 429) {
      toast.error('กรุณารอสักครู่แล้วลองใหม่', { id: toastId })
      return true
    }
    const body = error && typeof error === 'object' && 'body' in error ? error.body : undefined
    const result = KeywordFailureSchema.safeParse(body)
    if (!result.success) return false
    setFailure(result.data)
    toast.error(result.data.message, { id: toastId, duration: 6000 })
    return true
  }
  const error = <Dialog open={!!failure} onOpenChange={open => { if (!open) setFailure(null) }}>
    <DialogContent>
    <DialogTitle>Submission blocked</DialogTitle>
    <DialogDescription>Code does not meet this problem’s keyword requirements.</DialogDescription>
    {failure && <div role="alert" className="text-sm space-y-2 break-words max-h-[50vh] overflow-y-auto">
    {failure.missing.length > 0 && <p>Missing required keywords: <code>{failure.missing.join(', ')}</code></p>}
    {failure.banned.length > 0 && <p>Banned keywords found: <code>{failure.banned.join(', ')}</code></p>}
    {failure.requiredKeywords.length > 0 && <p>Required keywords (all): <code>{failure.requiredKeywords.join(', ')}</code></p>}
    {failure.bannedKeywords.length > 0 && <p>Banned keywords: <code>{failure.bannedKeywords.join(', ')}</code></p>}
    </div>}
    <DialogFooter><DialogClose asChild><Button>OK</Button></DialogClose></DialogFooter>
    </DialogContent>
  </Dialog>
  return { handleError, reset: () => setFailure(null), error }
}
