import { Controller, Get, Post, Req, Res, UseGuards, HttpCode } from '@nestjs/common'
import {
  TsRestHandler,
  nestControllerContract,
  tsRestHandler,
} from '@ts-rest/nest'
import type { Request, Response } from 'express'
import { AccessState } from 'src/core/constants'
import { OfflineAccess } from 'src/core/decorators/offline-mode.decorator'
import { User } from 'src/core/decorators/user.decorator'
import { environment } from 'src/env'

import { authRouter } from '@otog/contract'

import { Public } from '../../core/decorators/isPublic.decorator'
import { JwtRefreshTokenAuthGuard } from '../../core/guards/jwt-refreshtoken-auth.guard'
import { LocalAuthGuard } from '../../core/guards/local-auth.guard'
import { UserDTO } from '../user/dto/user.dto'
import { AuthService } from './auth.service'
import { AuthResDTO } from './dto/auth.dto'

const c = nestControllerContract(authRouter)

@Public()
@Controller()
export class AuthController {
  constructor(private authService: AuthService) {}

  @TsRestHandler(c.register)
  register() {
    return tsRestHandler(c.register, async ({ body }) => {
      const result = await this.authService.signup(body)
      return { status: 201, body: { message: result.message } }
    })
  }

  @UseGuards(LocalAuthGuard)
  @OfflineAccess(AccessState.Public)
  @Post('/auth/login')
  @HttpCode(200)
  async login(@User() userData: UserDTO, @Res() res: Response) {
    const { token, user } = await this.authService.login(userData)
    const authResDTO = new AuthResDTO()
    authResDTO.user = user
    authResDTO.accessToken = token.accessToken
    return res
      .cookie('RID', token.refreshToken.id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: res.req.secure || res.req.headers['x-forwarded-proto'] === 'https',
        path: '/',
        domain: environment.COOKIE_DOMAIN,
        expires: token.refreshToken.expiryDate ?? undefined,
      })
      .json(authResDTO)
  }

  @UseGuards(JwtRefreshTokenAuthGuard)
  @OfflineAccess(AccessState.Public)
  // Like login, this handler writes its response directly. A ts-rest handler
  // would try to invoke that response as a function after it has been sent.
  @Get('/auth/refresh/token')
  async refreshToken(@User() userData: UserDTO, @Res() res: Response) {
    const { token, user } = await this.authService.reAccessToken(userData)
    const authResDTO = new AuthResDTO()
    authResDTO.user = user
    authResDTO.accessToken = token.accessToken
    return res
      .cookie('RID', token.refreshToken.id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: res.req.secure || res.req.headers['x-forwarded-proto'] === 'https',
        path: '/',
        domain: environment.COOKIE_DOMAIN,
        expires: token.refreshToken.expiryDate ?? undefined,
      })
      .json(authResDTO)
  }

  @OfflineAccess(AccessState.Authenticated)
  @Post('/auth/logout')
  async logout(@Res() res: Response, @Req() req: Request) {
    await this.authService.revokeSession(req.cookies?.RID)
    res.clearCookie('RID', {
      httpOnly: true,
      domain: environment.COOKIE_DOMAIN,
    })
    return res.status(200).send({})
  }
}
