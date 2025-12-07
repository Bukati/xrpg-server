import { Module, forwardRef } from '@nestjs/common';
import { GameService } from './game.service';
import { QuestsController } from './quests.controller';
import { GrokModule } from '../grok/grok.module';
import { TweetsModule } from '../tweets/tweets.module';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { QueuesModule } from '../queues/queues.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    GrokModule,
    TweetsModule,
    AuthModule,
    forwardRef(() => QueuesModule),
  ],
  controllers: [QuestsController],
  providers: [GameService],
  exports: [GameService],
})
export class GameModule {}
