import { BadRequestException, Controller, Delete, Get, Header, Param, ParseIntPipe, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Role } from '../../core/constants'
import { Roles } from '../../core/decorators/roles.decorator'
import { User } from '../../core/decorators/user.decorator'
import { RolesGuard } from '../../core/guards/roles.guard'
import { UserDTO } from './dto/user.dto'
import { AvatarService, MAX_AVATAR_BYTES } from './avatar.service'

@Controller('/user/avatar')
@UseGuards(RolesGuard)
export class AvatarController {
  constructor(private readonly avatars: AvatarService) {}

  @Get(':userId')
  @Header('Cache-Control', 'no-store')
  get(@Param('userId', ParseIntPipe) userId: number, @Query('size') size = 'default') {
    if (userId < 1 || userId > 2147483647 || !['default', 'small'].includes(size)) throw new BadRequestException('Invalid avatar request.')
    return this.avatars.get(userId, size as 'default' | 'small')
  }

  @Post()
  @Roles(Role.Admin, Role.User)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 0 } }))
  upload(@User() user: UserDTO, @UploadedFile() file?: { buffer: Buffer }) {
    return this.avatars.upload(user.id, file?.buffer)
  }

  @Delete()
  @Roles(Role.Admin, Role.User)
  remove(@User() user: UserDTO) { return this.avatars.remove(user.id) }

  @Post(':userId')
  @Roles(Role.Admin)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 0 } }))
  async uploadForUser(@Param('userId', ParseIntPipe) userId: number, @UploadedFile() file?: { buffer: Buffer }) {
    this.validateUserId(userId)
    await this.avatars.assertUserExists(userId)
    return this.avatars.upload(userId, file?.buffer)
  }

  @Delete(':userId')
  @Roles(Role.Admin)
  async removeForUser(@Param('userId', ParseIntPipe) userId: number) {
    this.validateUserId(userId)
    await this.avatars.assertUserExists(userId)
    return this.avatars.remove(userId)
  }

  private validateUserId(userId: number) {
    if (userId < 1 || userId > 2147483647) throw new BadRequestException('Invalid user ID.')
  }
}
