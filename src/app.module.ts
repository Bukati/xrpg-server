import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { TweetsModule } from './tweets/tweets.module';
import { XStreamModule } from './x-stream/x-stream.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { GrokModule } from './grok/grok.module';
import { GameModule } from './game/game.module';
import { QueuesModule } from './queues/queues.module';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    GrokModule,
    GameModule,
    QueuesModule,
    AuthModule,
    TweetsModule,
    XStreamModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
