import { NotFoundException } from '@nestjs/common'
import type { Prisma } from '@otog/database'
import type { PrismaService } from '../core/database/prisma.service'

export type ActivityViewer = { id: number; role: string } | undefined

export function canReadActivity(owner: { id: number; role: string }, viewer: ActivityViewer) {
  return owner.role !== 'admin' || viewer?.id === owner.id || viewer?.role === 'admin'
}

// Leaderboard visibility deliberately does not control activity visibility.
export function activityOwnerFilter(viewer: ActivityViewer): Prisma.UserWhereInput {
  if (viewer?.role === 'admin') return {}
  return { OR: [{ role: { not: 'admin' } }, ...(viewer ? [{ id: viewer.id }] : [])] }
}

export async function assertActivityReadable(
  db: Pick<PrismaService, 'user'>, ownerId: number, viewer: ActivityViewer
) {
  if (viewer?.role === 'admin' || viewer?.id === ownerId) return
  const owner = await db.user.findUnique({ where: { id: ownerId }, select: { id: true, role: true } })
  if (!owner || !canReadActivity(owner, viewer)) throw new NotFoundException()
}
