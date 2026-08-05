import { Module } from '@nestjs/common';
import { MerchantModule } from '../merchant/merchant.module';
import { TestDashboardGuard } from './test-dashboard.guard';
import { TestDashboardService } from './test-dashboard.service';
import { TestDashboardController } from './test-dashboard.controller';

/**
 * LOCAL TEST TOOL, never for production. Dev-gated (404 outside
 * NODE_ENV=development) self-serve dashboard for creating test businesses
 * and test API keys. Imports MerchantModule for its exported
 * KeyIssuanceService, the single issuance path the ops script also drives.
 * DbService comes from the global DbModule.
 */
@Module({
  imports: [MerchantModule],
  providers: [TestDashboardGuard, TestDashboardService],
  controllers: [TestDashboardController],
})
export class TestDashboardModule {}
