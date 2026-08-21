import { Module } from '@nestjs/common';
import { JupiterTokenMetadataAdapter } from './jupiter-token-metadata.adapter';
import { TOKEN_METADATA_PROVIDER } from './token-metadata.interface';
import { TokenNamer } from './token-namer.service';

@Module({
  providers: [
    JupiterTokenMetadataAdapter,
    TokenNamer,
    {
      provide: TOKEN_METADATA_PROVIDER,
      useClass: JupiterTokenMetadataAdapter,
    },
  ],
  exports: [TOKEN_METADATA_PROVIDER, TokenNamer],
})
export class TokensModule {}
