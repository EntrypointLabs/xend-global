import { Controller, Get, Header } from '@nestjs/common';
import { DisplayRates, DisplayRatesService } from './display-rates.service';

/**
 * Unauthenticated, like /features: it says nothing about any Consumer, and the
 * Home card reads it alongside the balance.
 */
@Controller('fx')
export class DisplayRatesController {
  constructor(private readonly rates: DisplayRatesService) {}

  @Get('display-rates')
  @Header('Cache-Control', 'public, max-age=300')
  current(): Promise<DisplayRates> {
    return this.rates.current();
  }
}
