import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GameService } from '../game/game.service';

@Processor('chapter-progression')
export class ChapterProgressionProcessor extends WorkerHost {
  private readonly logger = new Logger(ChapterProgressionProcessor.name);

  constructor(private gameService: GameService) {
    super();
  }

  async process(job: Job<{ questId: string; chapterNumber: number }>): Promise<void> {
    this.logger.log(`Processing chapter progression job ${job.id} for Quest ${job.data.questId}, Chapter ${job.data.chapterNumber}`);

    const { questId, chapterNumber } = job.data;

    try {
      await this.gameService.collectVotesAndProgressChapter(questId, chapterNumber);
      this.logger.log(`Chapter ${chapterNumber} progression completed for Quest ${questId}`);
    } catch (error) {
      this.logger.error(`Failed to progress chapter: ${error.message}`);
      throw error;
    }
  }
}
