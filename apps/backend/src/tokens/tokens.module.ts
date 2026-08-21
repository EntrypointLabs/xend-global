import { Module } from '@nestjs/common';
import { JupiterTokenMetadataAdapter } from './jupiter-token-metadata.adapter';
import { TOKEN_METADATA_PROVIDER } from './token-metadata.interface';

@Module({
  providers: [
    JupiterTokenMetadataAdapter,
    {
      provide: TOKEN_METADATA_PROVIDER,
      useClass: JupiterTokenMetadataAdapter,
    },
  ],
  exports: [TOKEN_METADATA_PROVIDER],
})
export class TokensModule {}
