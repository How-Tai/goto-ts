import { Logger, OnModuleDestroy } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { userList } from 'src/utils'
import { allowedOrigins } from '../../utils/security-middleware'
import { TokenBuckets } from '../../utils/token-bucket'

import { UserDTO } from '../user/dto/user.dto'
import { ChatService } from './chat.service'
import { SubmissionService } from '../submission/submission.service'
import { SubmissionUpdatesService } from '../submission/submission-updates.service'

interface AuthenticatedChatClient {
  user: UserDTO
  jwtId: string
  expiresAt: number
  expiryTimer?: ReturnType<typeof setTimeout>
}

@WebSocketGateway({
  cors: {
    credentials: true,
    origin: (origin: string | undefined, callback: (error: Error | null, allow: boolean) => void) =>
      callback(null, !origin || allowedOrigins().has(origin)),
  },
  allowRequest: (request: { headers: { origin?: string } }, callback: (error: string | null, allow: boolean) => void) =>
    callback(null, !request.headers.origin || allowedOrigins().has(request.headers.origin)),
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  constructor(
    private chatService: ChatService,
    private jwtService: JwtService,
    private submissionService: SubmissionService,
    private submissionUpdates: SubmissionUpdatesService
  ) {}
  @WebSocketServer() server!: Server

  private logger: Logger = new Logger('MessageGateway')
  private readonly watches = new Map<Socket, Map<number, string>>()
  private readonly changed = new Set<number>()
  private flushTimer?: ReturnType<typeof setTimeout>
  private flushing = false
  private readonly watchWindows = new WeakMap<Socket, number>()
  private readonly accountSockets = new Map<number, Set<Socket>>()
  private readonly socketAccounts = new WeakMap<Socket, number>()
  private readonly inFlight = new Map<number, number>()
  private readonly admission = new TokenBuckets()

  private eventIdentity(client: Socket) {
    const identity = this.authenticatedClients.get(client)
    if (!identity || !client.connected || identity.expiresAt <= Date.now()) {
      this.clearAuthentication(client); client.disconnect(true)
      throw new WsException('Authentication required.')
    }
    if (!this.admission.take('event:' + identity.user.id, { capacity: 60, refillPerSecond: 20 }).allowed)
      throw new WsException('กรุณารอสักครู่แล้วลองใหม่')
    return identity
  }
  private beginWork(userId: number) {
    const active = this.inFlight.get(userId) || 0
    if (active >= 2) return false
    this.inFlight.set(userId, active + 1); return true
  }
  private endWork(userId: number) {
    const active = (this.inFlight.get(userId) || 1) - 1
    if (active) this.inFlight.set(userId, active)
    else this.inFlight.delete(userId)
  }

  @SubscribeMessage('watch-submissions')
  async watchSubmissions(@ConnectedSocket() client: Socket, @MessageBody() value: unknown) {
    const identity = this.eventIdentity(client)
    if (!this.admission.take('watch:' + identity.user.id, { capacity: 10, refillPerSecond: 4 }).allowed)
      throw new WsException('กรุณารอสักครู่แล้วลองใหม่')
    const previous = this.watchWindows.get(client) ?? 0
    if (Date.now() - previous < 100) throw new WsException('Please wait before changing subscriptions.')
    this.watchWindows.set(client, Date.now())
    const ids = (value as { ids?: unknown })?.ids
    if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => !Number.isSafeInteger(id) || id < 1 || id > 2147483647)) {
      throw new WsException('Invalid submission subscription.')
    }
    const old = this.watches.get(client) ?? new Map<number, string>()
    const unique = [...new Set<number>(ids)]
    let otherWatches = 0
    for (const socket of this.accountSockets.get(identity.user.id) || [])
      if (socket !== client) otherWatches += this.watches.get(socket)?.size || 0
    if (otherWatches + unique.length > 1000) throw new WsException('Too many submission subscriptions.')
    this.watches.set(client, new Map(unique.map(id => [id, old.get(id) ?? ''])))
    const sent = await this.sendProgress(client, ids)
    return { live: sent !== false && this.submissionUpdates.ready }
  }

  private async sendProgress(client: Socket, ids: number[]) {
    const identity = this.authenticatedClients.get(client)
    if (!identity) return
    if (!this.beginWork(identity.user.id)) { client.emit('submission-live', false); return false }
    try {
    if (!identity || !client.connected || identity.expiresAt <= Date.now() ||
        !await this.chatService.isSessionActive(identity.user.id, identity.jwtId)) {
      this.clearAuthentication(client); client.disconnect(true); return
    }
    const user = await this.chatService.findUserForSocket(identity.user.id)
    if (!user) { this.clearAuthentication(client); client.disconnect(true); return }
    const selected = this.watches.get(client)
    if (!selected) return
    const rows = await this.submissionService.progressBatch([...new Set(ids)], user)
    if (identity.expiresAt <= Date.now()) { this.clearAuthentication(client); client.disconnect(true); return }
    if (!client.connected || this.watches.get(client) !== selected || this.authenticatedClients.get(client) !== identity) return
    const updates = rows.filter(row => {
      const version = JSON.stringify(row)
      if (!selected.has(row.id) || selected.get(row.id) === version) return false
      selected.set(row.id, version)
      return true
    })
    if (updates.length) client.emit('submission-progress', updates)
    } finally { this.endWork(identity.user.id) }
  }

  private queueProgress = (id: number) => {
    if (this.changed.size < 10000) this.changed.add(id)
    if (!this.flushTimer && !this.flushing) {
      this.flushTimer = setTimeout(() => { this.flushTimer = undefined; void this.flushProgress() }, 50)
      this.flushTimer.unref()
    }
  }

  private async flushProgress() {
    this.flushing = true
    const ids = new Set(this.changed); this.changed.clear()
    // Bound publication work independently of the number of sockets.
    const clients = [...this.watches].filter(([, watched]) => [...ids].some(id => watched.has(id)))
    for (let offset = 0; offset < clients.length; offset += 8) {
      await Promise.all(clients.slice(offset, offset + 8).map(async ([client, watched]) => {
        try { await this.sendProgress(client, [...ids].filter(id => watched.has(id))) }
        catch { client.emit('submission-live', false) }
      }))
    }
    this.flushing = false
    if (this.changed.size) this.queueProgress(this.changed.values().next().value!)
  }

  private availability = (ready: boolean) => {
    for (const [client, watched] of this.watches) {
      client.emit('submission-live', ready)
      if (ready) for (const id of watched.keys()) this.queueProgress(id)
    }
  }

  onModuleDestroy() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.submissionUpdates.events.off('changed', this.queueProgress)
    this.submissionUpdates.events.off('availability', this.availability)
    this.watches.clear()
    for (const sockets of this.accountSockets.values()) for (const socket of sockets) this.clearAuthentication(socket)
    this.accountSockets.clear()
  }
  // Only the server can create these identities, after successful JWT verification.
  private readonly authenticatedClients = new WeakMap<
    Socket,
    AuthenticatedChatClient
  >()

  @SubscribeMessage('chat-server')
  async receiveMsg(
    @ConnectedSocket() client: Socket,
    @MessageBody() message: unknown
  ) {
    const authenticated = this.eventIdentity(client)
    if (typeof message !== 'string' || message.length < 1 || message.length > 150)
      throw new WsException('Message must contain between 1 and 150 characters.')
    if (!this.admission.take('chat:' + authenticated.user.id, { capacity: 20, refillPerSecond: 2 }).allowed ||
        !this.beginWork(authenticated.user.id)) throw new WsException('กรุณารอสักครู่แล้วลองใหม่')
    try {
    if (
      !authenticated ||
      !client.connected ||
      authenticated.expiresAt <= Date.now() ||
      !await this.chatService.isSessionActive(authenticated.user.id, authenticated.jwtId)
    ) {
      this.clearAuthentication(client)
      client.disconnect(true)
      return
    }
    const { user } = authenticated

    const chat = await this.chatService.create(message, user.id)
    this.server.sockets.emit('chat', [
      chat.id,
      chat.message,
      chat.creationDate,
      [user.id, user.showName, user.rating],
    ])
    } finally { this.endWork(authenticated.user.id) }
  }

  public afterInit(server: Server): void {
    this.submissionUpdates.events.on('changed', this.queueProgress)
    this.submissionUpdates.events.on('availability', this.availability)
    server.use((client, next) => {
      void this.authenticate(client).then(
        () => next(),
        () => next(new Error('Authentication required'))
      )
    })
    return this.logger.log('ChatWebSocket initialized')
  }

  public handleDisconnect(client: Socket): void {
    this.clearAuthentication(client)
    return this.logger.log(`Client disconnected: ${client.id}`)
  }

  private clearAuthentication(client: Socket): void {
    this.watches.delete(client)
    const accountId = this.socketAccounts.get(client)
    if (accountId !== undefined) {
      const sockets = this.accountSockets.get(accountId)
      sockets?.delete(client)
      if (!sockets?.size) this.accountSockets.delete(accountId)
      this.socketAccounts.delete(client)
    }
    const authenticated = this.authenticatedClients.get(client)
    if (authenticated?.expiryTimer) clearTimeout(authenticated.expiryTimer)
    this.authenticatedClients.delete(client)
    if (userList.delete(client.id)) this.server.emit('online')
  }

  public handleConnection(client: Socket): void {
    const authenticated = this.authenticatedClients.get(client)
    if (!authenticated || authenticated.expiresAt <= Date.now()) {
      this.clearAuthentication(client)
      client.disconnect(true)
      return
    }
    userList.set(client.id, authenticated.user)
    this.scheduleExpiry(client, authenticated)
    this.server.emit('online')
    return this.logger.log(`Client connected: ${client.id}`)
  }

  private async authenticate(client: Socket): Promise<void> {
    const token: unknown = client.handshake.auth?.token
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.length > 16384
    ) {
      throw new Error('Invalid token')
    }
    const payload = await this.jwtService.verifyAsync<Record<string, unknown>>(
      token,
      {
        algorithms: ['HS256'],
        ignoreExpiration: false,
        ignoreNotBefore: false,
      }
    )
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof payload.id !== 'number' ||
      !Number.isSafeInteger(payload.id) ||
      payload.id <= 0 ||
      payload.id > 2147483647 ||
      typeof payload.jti !== 'string' ||
      typeof payload.exp !== 'number' ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp > Math.floor(Number.MAX_SAFE_INTEGER / 1000)
    ) {
      throw new Error('Invalid token claims')
    }
    // Display details and role come from the current database user, never token claims.
    let sockets = this.accountSockets.get(payload.id)
    if ((sockets?.size || 0) >= 8 || (!sockets && this.accountSockets.size >= 2048) ||
        !this.admission.take('connect:' + payload.id, { capacity: 20, refillPerSecond: 1 }).allowed)
      throw new Error('Connection limit reached.')
    if (!sockets) { sockets = new Set(); this.accountSockets.set(payload.id, sockets) }
    sockets.add(client); this.socketAccounts.set(client, payload.id)
    // A transport can close while namespace authentication is still awaiting
    // the database; Socket.IO does not emit its normal disconnect hook then.
    client.conn?.once('close', () => this.clearAuthentication(client))
    try {
    const user = await this.chatService.findUserForSocket(payload.id)
    const expiresAt = payload.exp * 1000
    if (!user || user.id !== payload.id || expiresAt <= Date.now() || !await this.chatService.isSessionActive(user.id, payload.jti as string)) {
      throw new Error('Invalid token user or expiry')
    }
    if (client.conn?.readyState === 'closed' || client.conn?.readyState === 'closing') throw new Error('Connection closed during authentication.')
    this.authenticatedClients.set(client, {
      user: new UserDTO(user),
      jwtId: payload.jti as string,
      expiresAt,
    })
    } catch (error) { this.clearAuthentication(client); throw error }
  }

  private scheduleExpiry(
    client: Socket,
    authenticated: AuthenticatedChatClient
  ): void {
    const remaining = authenticated.expiresAt - Date.now()
    if (remaining <= 0) {
      this.clearAuthentication(client)
      client.disconnect(true)
      return
    }
    // Avoid setTimeout overflow even if the access-token lifetime changes later.
    authenticated.expiryTimer = setTimeout(
      () => {
        void this.chatService.isSessionActive(authenticated.user.id, authenticated.jwtId).then(active => {
          if (this.authenticatedClients.get(client) !== authenticated) return
          if (!active) { this.clearAuthentication(client); client.disconnect(true) }
          else this.scheduleExpiry(client, authenticated)
        }).catch(() => { this.clearAuthentication(client); client.disconnect(true) })
      },
      Math.min(remaining, 15000)
    )
    authenticated.expiryTimer.unref()
  }
}
