import { Injectable, HttpException } from '@nestjs/common'
import { PrismaService } from 'src/core/database/prisma.service'

import { WITHOUT_PASSWORD } from '../user/user.service'

@Injectable()
export class ChatService {
  private readonly messageWindows = new Map<number, { since: number; count: number }>()
  constructor(private readonly prisma: PrismaService) {}

  async findUserForSocket(userId: number) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: WITHOUT_PASSWORD,
    })
  }

  async create(message: string, userId: number) {
    const now = Date.now()
    let window = this.messageWindows.get(userId)
    if (!window || now - window.since > 10000) {
      window = { since: now, count: 0 }; this.messageWindows.set(userId, window)
    }
    if (++window.count > 20) throw new HttpException('Please wait before sending more messages.', 429)
    if (this.messageWindows.size > 10000) for (const [id, item] of this.messageWindows) if (now - item.since > 10000) this.messageWindows.delete(id)
    return this.prisma.chat.create({ data: { message, userId } })
  }

  async isSessionActive(userId: number, jwtId: string) {
    return !!await this.prisma.refreshToken.findFirst({ where: { userId, jwtId, used: false, expiryDate: { gt: new Date() } }, select: { id: true } })
  }

  async findAll(offset = 1e9, take = 25) {
    return this.prisma.chat.findMany({
      where: { id: { lt: offset } },
      take,
      orderBy: { id: 'desc' },
      include: { user: { select: WITHOUT_PASSWORD } },
    })
  }
}
