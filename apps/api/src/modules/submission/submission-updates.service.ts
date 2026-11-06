import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { EventEmitter } from 'node:events'
import { NotificationClient } from '@otog/database'
import { environment } from '../../env'

@Injectable()
export class SubmissionUpdatesService implements OnModuleInit, OnModuleDestroy {
  readonly events = new EventEmitter()
  ready = false
  private client?: InstanceType<typeof NotificationClient>
  private retry?: ReturnType<typeof setTimeout>
  private stopped = false
  private delay = 1000
  private logger = new Logger(SubmissionUpdatesService.name)

  onModuleInit() { void this.connect() }
  private async connect() {
    if (this.stopped) return
    const client = new NotificationClient({ connectionString: environment.DATABASE_URL,
      application_name: 'otog-submission-events', connectionTimeoutMillis: 3000, keepAlive: true })
    this.client = client
    const lost = () => {
      if (this.client !== client) return
      this.client = undefined
      this.ready = false
      this.events.emit('availability', false)
      void client.end().catch(() => {})
      if (!this.stopped && !this.retry) {
        this.retry = setTimeout(() => { this.retry = undefined; void this.connect() }, this.delay)
        this.retry.unref()
        this.delay = Math.min(this.delay * 2, 30000)
      }
    }
    client.on('error', lost)
    client.on('end', lost)
    client.on('notification', message => {
      const id = Number(message.payload)
      if (message.channel === 'otog_submission_updates' && Number.isSafeInteger(id) && id > 0 && id <= 2147483647) this.events.emit('changed', id)
    })
    try {
      await client.connect()
      await client.query('LISTEN otog_submission_updates')
      if (this.stopped || this.client !== client) { await client.end(); return }
      this.delay = 1000
      this.ready = true
      this.events.emit('availability', true)
    } catch {
      this.logger.warn('Submission notifications unavailable; clients use batched polling.')
      lost()
    }
  }
  async onModuleDestroy() {
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    const client = this.client
    this.client = undefined
    this.ready = false
    if (client) await client.end().catch(() => {})
    this.events.removeAllListeners()
  }
}
