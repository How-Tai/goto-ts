import { useEffect, useRef, useState } from 'react'
import Cropper, { Area } from 'react-easy-crop'
import toast from 'react-hot-toast'
import { CropIcon, FileArrowUpIcon, XIcon } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@otog/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@otog/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@otog/ui/alert-dialog'
import { client } from '../api/browser'
import { uploadAvatar, removeAvatar } from '../api/avatar'
import { avatarKey } from '../api/query'
import { useUserContext } from '../context/user-context'

export const createImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Could not open this image.'))
  image.src = url
})

export async function getCroppedImage(image: HTMLImageElement, area: Area) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 640
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image editing is unavailable in this browser.')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, 640, 640)
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, 640, 640)
  return new Promise<File>((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob) return reject(new Error('Could not prepare this image.'))
    resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
  }, 'image/jpeg', 0.9))
}

function errorMessage(error: unknown) {
  const status = (error as { status?: number })?.status
  if (status === 429) return 'Please wait a few seconds before changing your picture again.'
  if (status === 413) return 'Choose a JPG or PNG no larger than 2 MB.'
  if (status === 400) return 'This image could not be processed. Try another JPG or PNG.'
  if (status === 401 || status === 403) return 'Sign in again to change your picture.'
  return 'Could not update your picture. Please try again.'
}

export function AvatarUpload({ userId }: { userId: number }) {
  const { user, isAdmin } = useUserContext()
  const canEdit = !!user && (user.id === userId || isAdmin)
  const targetUserId = user?.id === userId ? undefined : userId
  const input = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const avatar = useQuery(avatarKey.getUrl({ userId, size: 'default' }))
  const [editorImage, setEditorImage] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area>()
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => () => {
    if (editorImage?.startsWith('blob:')) URL.revokeObjectURL(editorImage)
  }, [editorImage])

  const refresh = async () => {
    await Promise.all(['default', 'small'].map(size => queryClient.invalidateQueries({
      queryKey: avatarKey.getUrl({ userId, size: size as 'default' | 'small' }).queryKey,
    })))
  }
  const openEditor = (url: string) => {
    setCrop({ x: 0, y: 0 }); setZoom(1); setArea(undefined); setEditorImage(url)
  }
  const selectFile = async (file?: File) => {
    if (!file || busy.current) return
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      toast.error('Choose a JPG or PNG no larger than 2 MB.'); return
    }
    const url = URL.createObjectURL(file)
    try {
      const image = await createImage(url)
      if (image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 20_000_000) {
        throw new Error('Choose an image no larger than 20 megapixels.')
      }
      openEditor(url)
    } catch {
      URL.revokeObjectURL(url); toast.error('Could not open this image. Use a JPG or PNG up to 20 megapixels.')
    }
  }
  const save = async () => {
    if (busy.current || !editorImage || !area || !canEdit) return
    busy.current = true; setPending(true)
    try {
      const file = await getCroppedImage(await createImage(editorImage), area)
      await uploadAvatar(client, file, targetUserId)
      setEditorImage(null)
      await refresh()
      toast.success('Profile picture updated.')
    } catch (error) { toast.error(errorMessage(error)) }
    finally { busy.current = false; setPending(false) }
  }
  const remove = async () => {
    if (busy.current || !canEdit) return
    busy.current = true; setPending(true); setDeleteOpen(false)
    try {
      await removeAvatar(client, targetUserId)
      await refresh(); toast.success('Profile picture removed.')
    } catch (error) { toast.error(errorMessage(error)) }
    finally { busy.current = false; setPending(false) }
  }
  if (!canEdit) return null

  return <>
    <input ref={input} type="file" className="hidden" accept="image/jpeg,image/png" aria-label="Choose profile picture" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; void selectFile(file)
    }} />
    <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => input.current?.click()}>
        <FileArrowUpIcon /> {pending ? 'Updating…' : 'อัปโหลด'}
      </Button>
      {avatar.data && <>
        <Button size="sm" variant="secondary" aria-label="Crop profile picture" disabled={pending} onClick={() => openEditor(avatar.data!)}><CropIcon /></Button>
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogTrigger asChild><Button size="sm" variant="secondary" aria-label="Remove profile picture" disabled={pending}><XIcon /></Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Remove profile picture?</AlertDialogTitle><AlertDialogDescription>The generated avatar will be shown instead.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void remove()}>Remove</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>}
    </div>
    <Dialog open={!!editorImage} onOpenChange={open => { if (!open && !pending) setEditorImage(null) }}>
      <DialogContent>
        <DialogTitle>Crop profile picture</DialogTitle>
        <div className="relative h-80 w-full bg-black">
          {editorImage && <Cropper image={editorImage} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setArea(pixels)} />}
        </div>
        <label className="flex items-center gap-3">Zoom<input aria-label="Picture zoom" type="range" min="1" max="3" step="0.05" value={zoom} disabled={pending} onChange={event => setZoom(Number(event.target.value))} className="flex-1" /></label>
        <p className="text-sm text-muted-foreground">JPG or PNG, up to 2 MB. Your picture is stored in the cloud.</p>
        <DialogFooter><Button variant="secondary" disabled={pending} onClick={() => setEditorImage(null)}>Cancel</Button><Button disabled={pending || !area} onClick={() => void save()}>{pending ? 'Uploading…' : 'Save picture'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
