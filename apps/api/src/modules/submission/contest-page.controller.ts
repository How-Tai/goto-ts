import { BadRequestException, Controller, Header, UseGuards } from '@nestjs/common'
import { nestControllerContract, TsRestHandler, tsRestHandler } from '@ts-rest/nest'
import { contestRouter } from '@otog/contract'
import { AccessState, Role } from '../../core/constants'
import { OfflineAccess } from '../../core/decorators/offline-mode.decorator'
import { Roles } from '../../core/decorators/roles.decorator'
import { User } from '../../core/decorators/user.decorator'
import { RolesGuard } from '../../core/guards/roles.guard'
import { UserDTO } from '../user/dto/user.dto'
import { ContestPageService } from './contest-page.service'

const c = nestControllerContract(contestRouter)
const id = (value: string) => {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647) throw new BadRequestException('Invalid ID.')
  return number
}

@Controller()
@UseGuards(RolesGuard)
export class ContestPageController {
  constructor(private readonly pages: ContestPageService) {}

  @TsRestHandler(c.getContestPage)
  @OfflineAccess(AccessState.Authenticated)
  @Header('Cache-Control', 'private, no-store')
  getContestPage() {
    return tsRestHandler(c.getContestPage, async ({ params }) => {
      const body = await this.pages.contestPage(id(params.contestId))
      return body ? { status: 200, body } : { status: 404, body: { message: 'Not Found' } }
    })
  }

  @TsRestHandler(c.getContestProblemPage)
  @OfflineAccess(AccessState.Authenticated)
  @Roles(Role.User, Role.Admin)
  @Header('Cache-Control', 'private, no-store')
  getContestProblemPage(@User() user: UserDTO) {
    return tsRestHandler(c.getContestProblemPage, async ({ params }) => {
      const result = await this.pages.problemPage(id(params.contestId), id(params.problemId), user)
      if (result.status === 200) return result
      return { status: result.status, body: { message: result.status === 404 ? 'Not Found' : 'Forbidden' } }
    })
  }
}
