import { BadRequestException, ExecutionContext, Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { loginCredentials } from '../../utils/auth-admission'

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest()
    const credentials = loginCredentials(req)
    if (!credentials) throw new BadRequestException('Credentials must be supplied in the request body.')
    req.body = credentials
    return super.canActivate(context)
  }
}
