import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GameService } from '../game/game.service';

@Processor('quest-evaluation')
export class QuestEvaluationProcessor extends WorkerHost {
  private readonly logger = new Logger(QuestEvaluationProcessor.name);

  constructor(private gameService: GameService) {
    super();
  }

  async process(job: Job<{
    tweetId: string;
    mentionTweetId: string;
    conversationId?: string;
    tweetText: string;
    authorHandle: string
  }>): Promise<void> {
    this.logger.log(`Processing quest evaluation job ${job.id}`);

    const { tweetId, mentionTweetId, conversationId, tweetText, authorHandle } = job.data;

    try {
      const result = await this.gameService.evaluateAndStartQuest(
        tweetId,
        mentionTweetId,
        conversationId,
        tweetText,
        authorHandle,
      );

      if (result.started) {
        this.logger.log(`Quest ${result.questId} started successfully`);
      } else {
        this.logger.log(`Quest rejected: ${result.message}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process quest evaluation: ${error.message}`);
      throw error;
    }
  }
}
