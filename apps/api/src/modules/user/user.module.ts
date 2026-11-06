import { Module } from '@nestjs/common'

import { UserController } from './user.controller'
import { UserService } from './user.service'
import { AvatarController } from './avatar.controller'
import { AvatarService } from './avatar.service'

@Module({
  controllers: [UserController, AvatarController],
  providers: [UserService, AvatarService],
  exports: [UserService],
})
export class UserModule {}
