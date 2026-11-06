import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { hashPassword, verifyPassword } from '../../utils/password'
import { PrismaService } from 'src/core/database/prisma.service'
import { v4 as uuidv4 } from 'uuid'

import { RefreshToken, User } from '@otog/database'

import { UserDTO } from '../user/dto/user.dto'
import { UserService } from '../user/user.service'

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private readonly prisma: PrismaService
  ) {}

  async signup(data: Pick<User, 'username' | 'password' | 'showName'>) {
    return await this.userService.create(data)
  }

  async validateUser(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } })
    if (!user) {
      throw new UnauthorizedException('Invalid username or password.')
    }
    if (await verifyPassword(password, user.password)) {
      if (!user.password.startsWith('scrypt$')) {
        const upgraded = await hashPassword(password)
        await this.prisma.user.updateMany({ where: { id: user.id, password: user.password }, data: { password: upgraded } })
      }
      ;(user.password as string | undefined) = undefined
      return user
    }
    return null
  }

  async login(user: UserDTO) {
    const token = await this.generateToken(user)
    return { token, user }
  }

  async findOneByRID(rid: string) {
    return this.prisma.refreshToken.findFirst({
      where: { id: rid, used: false, expiryDate: { gt: new Date() } },
    })
  }

  async reAccessToken(user: UserDTO) {
    const token = await this.generateToken(user)
    return { token, user }
  }

  async generateToken(user: UserDTO) {
    const payload = {
      id: user.id,
      username: user.username,
      showName: user.showName,
      role: user.role,
      rating: user.rating,
      showInLeaderboard: user.showInLeaderboard,
    }
    const jwtId = uuidv4()
    const accessToken = this.jwtService.sign(payload, {
      jwtid: jwtId,
    })

    const refreshToken = await this.generateRefreshToken(user, jwtId)
    return { accessToken, refreshToken }
  }

  async generateRefreshToken(user: UserDTO, jwtId: string) {
    const expiryDate = new Date()
    expiryDate.setDate(expiryDate.getDate() + 2)
    const refreshToken = await this.prisma.refreshToken.create({
      data: { userId: user.id, jwtId, expiryDate, id: uuidv4() },
    })
    return { id: refreshToken.id, expiryDate: refreshToken.expiryDate }
  }

  async validateToken(refreshTokenId: string, jwtId: string, userId: number) {
    if (typeof refreshTokenId !== 'string' || refreshTokenId.length > 128 || !refreshTokenId ||
        typeof jwtId !== 'string' || !jwtId || jwtId.length > 128 ||
        !Number.isSafeInteger(userId) || userId < 1 || userId > 2147483647) throw new ForbiddenException('Invalid refresh session.')
    const consumed = await this.prisma.refreshToken.updateMany({
      where: { id: refreshTokenId, jwtId, userId, used: false, expiryDate: { gt: new Date() } },
      data: { used: true },
    })
    if (consumed.count !== 1) throw new ForbiddenException('Refresh session expired, revoked or already used.')
  }

  async resolveAccessIdentity(payload: Record<string, unknown>) {
    if (!Number.isSafeInteger(payload.id) || Number(payload.id) < 1 || Number(payload.id) > 2147483647 || typeof payload.jti !== 'string') {
      throw new UnauthorizedException()
    }
    // Recheck current identity and revocation together; never cache authorization.
    const users = await this.prisma.$queryRaw<Array<Pick<User, 'id' | 'username' | 'showName' | 'role' | 'rating' | 'showInLeaderboard'>>>`
      SELECT U.id,U.username,U."showName",U.role,U.rating,U."showInLeaderboard" FROM "user" U
      WHERE U.id=${Number(payload.id)} AND EXISTS (
        SELECT 1 FROM "refreshToken" R WHERE R."userId"=U.id
        AND R."jwtId"=${payload.jti} AND R.used=false AND R."expiryDate">now()
      ) LIMIT 1`
    if (!users[0]) throw new UnauthorizedException()
    return new UserDTO(users[0])
  }

  async revokeSession(rid?: string) {
    if (rid) await this.prisma.refreshToken.updateMany({ where: { id: rid }, data: { used: true } })
  }

  isRefreshTokenLinkedToToken(refreshToken: RefreshToken, jwtId: string) {
    if (!refreshToken) return false
    if (refreshToken.jwtId != jwtId) return false
    return true
  }

  isRefreshTokenExpired(refreshToken: RefreshToken) {
    const now = new Date()
    if (!refreshToken?.expiryDate) return false
    if (refreshToken.expiryDate < now) return false
    return true
  }

  isRefreshTokenUsed(refreshToken: RefreshToken) {
    if (refreshToken.used) return false
    return true
  }
}
