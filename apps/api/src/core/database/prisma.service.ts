import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'

import { PrismaClient } from '@otog/database'
import { environment } from '../../env'

export function databasePoolUrl(value: string) {
  const url = new URL(value)
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '16')
  return url.toString()
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({ datasources: { db: { url: databasePoolUrl(environment.DATABASE_URL) } } })
  }

  async onModuleInit() {
    await this.$connect()
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
