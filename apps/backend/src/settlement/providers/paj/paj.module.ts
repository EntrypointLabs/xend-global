import { Module } from '@nestjs/common';
import { PajClient } from './paj.client';

@Module({
  providers: [PajClient],
  exports: [PajClient],
})
export class PajModule {}
