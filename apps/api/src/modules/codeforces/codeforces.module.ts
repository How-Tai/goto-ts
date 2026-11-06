import { Module } from '@nestjs/common'

import { CfCatalogController } from './catalog.controller'
import { CfCatalogService } from './catalog.service'
import { CodeforcesController } from './codeforces.controller'
import { CodeforcesService } from './codeforces.service'

@Module({
  controllers: [CfCatalogController, CodeforcesController],
  providers: [CodeforcesService, CfCatalogService],
})
export class CodeforcesModule {}
