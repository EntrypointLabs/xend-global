import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MerchantLogoService } from './merchant-logo.service';

const MERCHANT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Public logo images for the app. Unauthenticated on purpose: a logo is what a
 * Merchant shows the world, and an image tag cannot carry a bearer token.
 */
@Controller('v1/merchant-logos')
export class MerchantLogoController {
  constructor(private readonly logos: MerchantLogoService) {}

  @Get(':id')
  async logo(@Param('id') id: string, @Res() res: Response): Promise<void> {
    if (!MERCHANT_ID.test(id)) throw new NotFoundException();
    const logo = await this.logos.read(id);
    if (!logo) throw new NotFoundException();
    res
      .status(200)
      .setHeader('Content-Type', logo.contentType)
      .setHeader('Cache-Control', 'public, max-age=3600')
      // Images only: nothing here may be read as a document or a script.
      .setHeader('Content-Security-Policy', "default-src 'none'")
      .setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      .end(logo.data);
  }
}
