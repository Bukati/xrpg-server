import { Module } from '@nestjs/common';
import { FilteredStreamService } from './filtered-stream.service';
import { StreamRulesService } from './stream-rules.service';
import { PersistentStreamService } from './persistent-stream.service';
import { TweetsModule } from '../tweets/tweets.module';
import { QueuesModule } from '../queues/queues.module';

@Module({
  imports: [TweetsModule, QueuesModule],
  controllers: [],
  providers: [FilteredStreamService, StreamRulesService, PersistentStreamService],
  exports: [FilteredStreamService, StreamRulesService, PersistentStreamService],
})
export class XStreamModule {}
