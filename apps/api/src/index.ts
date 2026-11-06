import { NestFactory, Reflector } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder } from '@nestjs/swagger'
import { apiReference } from '@scalar/nestjs-api-reference'
import { generateOpenApi } from './utils/openapi'
import cookieParser from 'cookie-parser'

import { router } from '@otog/contract'

import { AppModule } from './app.module'
import { JwtAuthGuard } from './core/guards/jwt-auth.guard'
import { AccountRateLimitGuard } from './core/guards/account-rate-limit.guard'
import { OfflineModeGuard } from './core/guards/offline-mode.guard'
import { securityMiddleware, allowedOrigins } from './utils/security-middleware'
import { environment } from './env'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  app.use(cookieParser())
  // Account throttling needs the parsed body before Passport verifies passwords.
  // These preserve Express's normal 100 KiB JSON/form limits; multipart is untouched.
  app.useBodyParser('json', { limit: '100kb' })
  app.useBodyParser('urlencoded', { extended: true, limit: '100kb' })
  app.use(securityMiddleware)
  app.enableCors({
    credentials: true,
    origin: (origin, callback) => callback(null, !origin || allowedOrigins().has(origin)),
  })
  const reflector = app.get(Reflector)
  app.useGlobalGuards(
    new JwtAuthGuard(reflector),
    new AccountRateLimitGuard(reflector),
    environment.OFFLINE_MODE
      ? new OfflineModeGuard(reflector)
      : (undefined as never)
  )

  if (environment.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('OTOG API')
      .setDescription('API service for OTOG')
      .setVersion('1.0')
      .addBearerAuth()
      .build()
    const OpenApiSpecification = generateOpenApi(router, config)
    app.use(
      '/doc',
      apiReference({
        spec: {
          content: OpenApiSpecification,
        },
      })
    )
  }

  await app.listen(environment.PORT)
}

bootstrap()
