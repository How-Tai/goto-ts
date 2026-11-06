import { Controller, ForbiddenException, Get, Param, ParseIntPipe, Query, UseGuards, BadRequestException } from '@nestjs/common'
import { Role } from '../../core/constants'
import { Roles } from '../../core/decorators/roles.decorator'
import { User } from '../../core/decorators/user.decorator'
import { RolesGuard } from '../../core/guards/roles.guard'
import { UserDTO } from '../user/dto/user.dto'
import { SubmissionService } from '../submission/submission.service'
import { ProblemService } from './problem.service'

@Controller('/problem')
@UseGuards(RolesGuard)
export class KeywordRulesController {
  constructor(private readonly problems: ProblemService, private readonly submissions: SubmissionService) {}

  @Get(':problemId/keyword-rules')
  @Roles(Role.Admin, Role.User)
  async get(@Param('problemId', ParseIntPipe) problemId: number, @User() user: UserDTO, @Query('contestId') contest?: string) {
    const contestId = contest === undefined ? null : Number(contest)
    if (problemId < 1 || problemId > 2147483647 || contestId !== null && (!Number.isInteger(contestId) || contestId < 1 || contestId > 2147483647)) {
      throw new BadRequestException('Invalid problem or contest ID.')
    }
    if (user.role !== Role.Admin && !await this.submissions.isProblemInContestOrPublic({ problemId, contestId })) {
      throw new ForbiddenException()
    }
    return this.problems.getKeywordRules(problemId)
  }
}
