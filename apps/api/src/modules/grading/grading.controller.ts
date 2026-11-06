import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { Role } from '../../core/constants'
import { Roles } from '../../core/decorators/roles.decorator'
import { RolesGuard } from '../../core/guards/roles.guard'
import { GradingService } from './grading.service'
import { WorkerControlService } from './worker-control.service'
import { User } from '../../core/decorators/user.decorator'
import { UserDTO } from '../user/dto/user.dto'

@Controller('admin/grading')
@Roles(Role.Admin)
@UseGuards(RolesGuard)
export class GradingController {
  constructor(private readonly grading: GradingService, private readonly workers: WorkerControlService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  status(@Query('after') after?: string) {
    if (after === undefined) return this.grading.status()
    const parsed = z.coerce.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).safeParse(after)
    if (!parsed.success) throw new BadRequestException('Use a valid resource sample cursor.')
    return this.grading.status(parsed.data)
  }

  @Patch('settings')
  @Header('Cache-Control', 'no-store')
  setSettings(@Body() body: unknown) {
    const parsed = z.object({ maxWorkersPerUser: z.number().int().min(1).max(7) }).strict().safeParse(body)
    if (!parsed.success) throw new BadRequestException('Choose an integer from 1 to 7 for workers per user.')
    return this.grading.setMaxWorkersPerUser(parsed.data.maxWorkersPerUser)
  }

  @Patch('memory-reservations')
  @Header('Cache-Control', 'no-store')
  setMemoryReservations(@Body() body: unknown) {
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(body)
    if (!parsed.success) throw new BadRequestException('Use a boolean enabled value.')
    return this.grading.setMemoryReservations(parsed.data.enabled)
  }

  @Patch('compiler-jobs')
  @Header('Cache-Control', 'no-store')
  setCompilerJobs(@Body() body: unknown) {
    const parsed = z.object({ maxCompilerJobs: z.number().int().min(1).max(10) }).strict().safeParse(body)
    if (!parsed.success) throw new BadRequestException('Choose an integer from 1 to 10 for compiler jobs.')
    return this.grading.setMaxCompilerJobs(parsed.data.maxCompilerJobs)
  }

  @Patch('workers/:workerId')
  @Header('Cache-Control', 'no-store')
  async setWorker(@Param('workerId') rawId: string, @Body() body: unknown) {
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(body)
    if (!/^[1-7]$/.test(rawId) || !parsed.success) {
      throw new BadRequestException('Use worker 1–7 and a boolean enabled value.')
    }
    return this.grading.setEnabled(Number(rawId), parsed.data.enabled)
  }

  @Patch('worker-count')
  @Header('Cache-Control', 'no-store')
  setWorkerCount(@Body() body: unknown) {
    const parsed = z.object({ count: z.number().int().min(1).max(7) }).strict().safeParse(body)
    if (!parsed.success) throw new BadRequestException('Choose an integer from 1 to 7 for graders.')
    return this.grading.setWorkerCount(parsed.data.count)
  }

  @Post('workers/:workerId/kill')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  killWorker(@Param('workerId') rawId: string, @Body() body: unknown, @User() user: UserDTO) {
    const parsed = z.object({
      confirmed: z.literal(true),
      startedAt: z.string().datetime({ offset: true }),
      submissionId: z.number().int().positive().nullable(),
    }).strict().safeParse(body)
    if (!/^[1-7]$/.test(rawId) || !parsed.success) {
      throw new BadRequestException('Confirm worker 1–7 with its current job and start time.')
    }
    return this.workers.kill(Number(rawId), parsed.data, user.id)
  }
}
