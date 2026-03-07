import { Module, Global } from '@nestjs/common';
import { GridService } from './grid.service';

@Global()
@Module({
    providers: [GridService],
    exports: [GridService],
})
export class GridModule {}