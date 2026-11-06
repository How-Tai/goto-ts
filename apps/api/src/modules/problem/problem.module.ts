import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { ContestModule } from '../contest/contest.module'
import { SubmissionModule } from '../submission/submission.module'
import { UserModule } from '../user/user.module'
import { ProblemController } from './problem.controller'
import { ProblemService } from './problem.service'
import { KeywordRulesController } from './keyword-rules.controller'

@Module({
  imports: [ContestModule, AuthModule, UserModule, SubmissionModule],
  controllers: [ProblemController, KeywordRulesController],
  providers: [ProblemService],
  exports: [ProblemService],
})
export class ProblemModule {}
