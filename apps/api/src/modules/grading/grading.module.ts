import { Module } from '@nestjs/common'
import { GradingController } from './grading.controller'
import { GradingService } from './grading.service'
import { WorkerControlService } from './worker-control.service'

@Module({ controllers: [GradingController], providers: [GradingService, WorkerControlService] })
export class GradingModule {}
