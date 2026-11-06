import { Module } from '@nestjs/common'

import { ContestModule } from '../contest/contest.module'
import { SubmissionController } from './submission.controller'
import { SubmissionService } from './submission.service'
import { SubmissionUpdatesService } from './submission-updates.service'
import { ContestPageService } from './contest-page.service'
import { ContestPageController } from './contest-page.controller'

@Module({
  imports: [ContestModule],
  controllers: [SubmissionController, ContestPageController],
  providers: [SubmissionService, SubmissionUpdatesService, ContestPageService],
  exports: [SubmissionService, SubmissionUpdatesService],
})
export class SubmissionModule {}
