import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller';

/** GET /features: ConfigService comes from the global ConfigModule. */
@Module({
  controllers: [FeaturesController],
})
export class FeaturesModule {}
