import { Controller, Get, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FeaturesResponse {
  swap: boolean;
  earnDeposits: boolean;
  hideMyWallet: boolean;
}

/**
 * The app features the server allows right now. Each is on unless its kill
 * switch is set, and the app hides a switched-off feature on its next launch
 * or return to the foreground, with no new build.
 *
 * Unauthenticated, because the app reads it before anyone signs in and it says
 * nothing about any Consumer. Never cached: a switch that a proxy kept serving
 * the old answer for would not be a switch.
 */
@Controller('features')
export class FeaturesController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  current(): FeaturesResponse {
    return {
      swap: !this.switchedOff('SWAP_KILLSWITCH'),
      earnDeposits: !this.switchedOff('EARN_DEPOSITS_KILLSWITCH'),
      hideMyWallet: !this.switchedOff('HIDE_MY_WALLET_KILLSWITCH'),
    };
  }

  private switchedOff(key: string): boolean {
    return this.config.get<boolean>(key) === true;
  }
}
