import { useEffect, useState } from 'react'

import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import dynamic from 'next/dynamic'

import { Button } from '@otog/ui/button'
import {
  Dialog,
  DialogOverlay,
  DialogPrimitive,
  DialogTrigger,
} from '@otog/ui/dialog'

const SearchCombobox = dynamic(() => import('./search-combobox'), {
  ssr: false,
  loading: () => <p role="status" className="p-4">กำลังโหลดการค้นหา...</p>,
})

export function Search() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const openDialog = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', openDialog)
    return () => {
      document.removeEventListener('keydown', openDialog)
    }
  }, [])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full">
          <MagnifyingGlassIcon
            aria-label="ค้นหา"
            className="text-muted-foreground"
          />
        </Button>
      </DialogTrigger>
      <DialogPrimitive.Portal>
        <DialogOverlay>
          <DialogPrimitive.Content className="self-start">
            {open && <SearchCombobox onClose={() => setOpen(false)} />}
          </DialogPrimitive.Content>
        </DialogOverlay>
      </DialogPrimitive.Portal>
    </Dialog>
  )
}

