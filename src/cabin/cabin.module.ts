import { Module } from '@nestjs/common';
import { CabinService } from './cabin.service';
import { CabinResolver } from './cabin.resolver';
import { Cabin, CabinSchema } from './cabin.schema';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Cabin.name, schema: CabinSchema }]),
  ],
  providers: [CabinResolver, CabinService],
})
export class CabinModule {}
