import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QuestEvaluationProcessor } from './quest-evaluation.processor';
import { ChapterProgressionProcessor } from './chapter-progression.processor';
import { GameModule } from '../game/game.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        console.log('BullMQ connecting to Redis:', redisUrl.replace(/:[^:@]+@/, ':****@')); // Log URL with password masked

        const url = new URL(redisUrl);
        const config: any = {
          host: url.hostname,
          port: parseInt(url.port) || 6379,
          username: url.username || undefined,
          password: url.password || undefined,
          maxRetriesPerRequest: null,
        };

        // Enable TLS for rediss:// URLs with relaxed cert validation
        if (url.protocol === 'rediss:') {
          config.tls = {
            rejectUnauthorized: false, // Allow self-signed certificates
          };
        }

        return { connection: config };
      },
    }),
    BullModule.registerQueue(
      {
        name: 'quest-evaluation',
      },
      {
        name: 'chapter-progression',
      },
    ),
    GameModule,
  ],
  providers: [QuestEvaluationProcessor, ChapterProgressionProcessor],
  exports: [BullModule],
})
export class QueuesModule {}
