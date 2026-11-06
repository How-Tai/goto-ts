import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'

import { PrismaService } from '../../core/database/prisma.service'

type Avatar = { publicId: string; version: number; cloudName: string }
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024

export function imageDimensions(bytes: Buffer) {
  let width = 0
  let height = 0
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (bytes.toString('ascii', 12, 16) !== 'IHDR') throw new BadRequestException('Invalid PNG image.')
    width = bytes.readUInt32BE(16)
    height = bytes.readUInt32BE(20)
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === undefined) break
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3)
        width = bytes.readUInt16BE(offset + 5)
        break
      }
      offset += length
    }
  }
  if (!width || !height) throw new BadRequestException('Choose a valid JPG or PNG image.')
  if (width > 8192 || height > 8192 || width * height > 20_000_000) {
    throw new BadRequestException('Image dimensions are too large (maximum 20 megapixels).')
  }
  return { width, height }
}

export function signCloudinary(params: Record<string, string>, secret: string) {
  const canonical = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&')
  return createHash('sha1').update(canonical + secret).digest('hex')
}

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name)
  private readonly active = new Set<number>()
  private readonly lastChange = new Map<number, number>()
  private readonly cache = new Map<number, { value: Avatar | null; expires: number }>()

  constructor(private readonly prisma: PrismaService) {}

  async assertUserExists(userId: number) {
    if (!await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } })) {
      throw new NotFoundException('User not found.')
    }
  }

  private credentials() {
    const cloud = process.env.CLOUDINARY_CLOUD_NAME?.trim()
    const key = process.env.CLOUDINARY_API_KEY?.trim()
    const secret = process.env.CLOUDINARY_API_SECRET?.trim()
    if (!cloud || !/^[a-zA-Z0-9_-]+$/.test(cloud) || !key || !secret) {
      throw new ServiceUnavailableException('Profile-picture storage is not configured.')
    }
    return { cloud, key, secret }
  }

  private async record(userId: number): Promise<Avatar | null> {
    const cached = this.cache.get(userId)
    if (cached && cached.expires > Date.now()) return cached.value
    const rows = await this.prisma.$queryRaw<Avatar[]>`
      SELECT "publicId", "version", "cloudName" FROM "otogUserAvatar" WHERE "userId" = ${userId}`
    const value = rows[0] ?? null
    if (this.cache.size >= 2000) this.cache.clear()
    this.cache.set(userId, { value, expires: Date.now() + 60_000 })
    return value
  }

  async get(userId: number, size: 'default' | 'small') {
    const avatar = await this.record(userId)
    if (!avatar) return { url: null }
    const transform = size === 'small' ? 'c_fill,w_32,h_32,q_auto,f_auto' : 'q_auto,f_auto'
    const encodedId = avatar.publicId.split('/').map(encodeURIComponent).join('/')
    return { url: `https://res.cloudinary.com/${encodeURIComponent(avatar.cloudName)}/image/upload/${transform}/v${avatar.version}/${encodedId}.jpg` }
  }

  private begin(userId: number) {
    if (this.active.has(userId) || this.active.size >= 3) {
      throw new HttpException('An image operation is in progress. Try again shortly.', 429)
    }
    if ((this.lastChange.get(userId) ?? 0) > Date.now() - 10_000) {
      throw new HttpException('Wait 10 seconds between picture changes.', 429)
    }
    this.active.add(userId)
  }

  private async call(action: 'upload' | 'destroy', params: Record<string, string>, bytes?: Buffer) {
    const { cloud, key, secret } = this.credentials()
    const form = new FormData()
    for (const [name, value] of Object.entries(params)) form.set(name, value)
    form.set('api_key', key)
    form.set('signature', signCloudinary(params, secret))
    if (bytes) form.set('file', new Blob([new Uint8Array(bytes)]), 'avatar-image')
    try {
      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/${action}`, {
        method: 'POST', body: form, signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) {
        if (response.status === 400 && action === 'upload') throw new BadRequestException('The image could not be processed. Choose another JPG or PNG.')
        throw new ServiceUnavailableException('Cloud image storage is unavailable. Try again later.')
      }
      return await response.json() as { public_id?: string; version?: number; format?: string; resource_type?: string; result?: string }
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException('Cloud image storage did not respond. Try again later.')
    }
  }

  private async destroy(avatar: Avatar) {
    const { cloud } = this.credentials()
    if (avatar.cloudName !== cloud || !avatar.publicId.startsWith('otog-avatars/user-')) {
      throw new ServiceUnavailableException('Picture belongs to a different storage environment.')
    }
    const result = await this.call('destroy', { public_id: avatar.publicId, invalidate: 'true', timestamp: `${Math.floor(Date.now() / 1000)}` })
    if (!['ok', 'not found'].includes(result.result ?? '')) throw new ServiceUnavailableException('Could not remove the previous picture.')
  }

  async upload(userId: number, bytes: Buffer | undefined) {
    if (!bytes?.length || bytes.length > MAX_AVATAR_BYTES) throw new BadRequestException('Choose a JPG or PNG no larger than 2 MB.')
    imageDimensions(bytes)
    this.credentials()
    this.begin(userId)
    try {
      const old = await this.record(userId)
      const publicId = `otog-avatars/user-${userId}/${randomUUID()}`
      const result = await this.call('upload', {
        public_id: publicId, overwrite: 'false', timestamp: `${Math.floor(Date.now() / 1000)}`,
        transformation: 'c_fill,g_auto,w_640,h_640/q_auto/f_jpg/fl_strip_profile',
      }, bytes)
      if (result.public_id !== publicId || result.resource_type !== 'image' || result.format !== 'jpg' || !Number.isSafeInteger(result.version) || result.version! <= 0) {
        throw new ServiceUnavailableException('Unexpected image-storage response.')
      }
      const avatar: Avatar = { publicId, version: result.version!, cloudName: this.credentials().cloud }
      try {
        await this.prisma.$executeRaw`
          INSERT INTO "otogUserAvatar" ("userId", "publicId", "version", "cloudName")
          VALUES (${userId}, ${avatar.publicId}, ${avatar.version}, ${avatar.cloudName})
          ON CONFLICT ("userId") DO UPDATE SET "publicId"=EXCLUDED."publicId", "version"=EXCLUDED."version", "cloudName"=EXCLUDED."cloudName", "updatedAt"=now()`
      } catch {
        await this.destroy(avatar).catch(() => this.logger.warn('Could not clean up an uncommitted avatar.'))
        throw new ServiceUnavailableException('Could not save the picture. Your previous picture is unchanged.')
      }
      this.cache.delete(userId)
      this.lastChange.set(userId, Date.now())
      if (this.lastChange.size > 2000) {
        for (const [id, at] of this.lastChange) if (at < Date.now() - 60_000) this.lastChange.delete(id)
      }
      if (old) await this.destroy(old).catch(() => this.logger.warn('Previous avatar cleanup failed; new avatar remains available.'))
      return await this.get(userId, 'default')
    } finally { this.active.delete(userId) }
  }

  async remove(userId: number) {
    this.begin(userId)
    try {
      const old = await this.record(userId)
      if (old) await this.destroy(old)
      await this.prisma.$executeRaw`DELETE FROM "otogUserAvatar" WHERE "userId"=${userId}`
      this.cache.delete(userId)
      this.lastChange.set(userId, Date.now())
      return { url: null }
    } finally { this.active.delete(userId) }
  }
}
