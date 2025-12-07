import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../database/prisma.service';
import { GrokService } from '../grok/grok.service';
import { TweetsService } from '../tweets/tweets.service';
import { RedisService } from '../redis/redis.service';
import { Queue } from 'bullmq';
import { nanoid } from 'nanoid';

@Injectable()
export class GameService implements OnModuleInit {
  private readonly logger = new Logger(GameService.name);

  constructor(
    private prisma: PrismaService,
    private grok: GrokService,
    private tweets: TweetsService,
    private redis: RedisService,
    @InjectQueue('chapter-progression') private chapterProgressionQueue: Queue,
  ) {}

  async onModuleInit() {
    this.logger.log('Checking for stuck quests with expired deadlines...');
    await this.recoverStuckQuests();
  }

  private async recoverStuckQuests() {
    try {
      const stuckQuests = await this.prisma.quest.findMany({
        where: {
          status: 'ACTIVE',
          chapterDeadline: {
            lt: new Date(),
          },
        },
        include: {
          chapters: {
            orderBy: { chapterNumber: 'desc' },
            take: 1,
          },
        },
      });

      if (stuckQuests.length === 0) {
        this.logger.log('No stuck quests found');
        return;
      }

      this.logger.log(`Found ${stuckQuests.length} stuck quests, processing immediately...`);

      for (const quest of stuckQuests) {
        // Check if the next chapter already exists (to prevent duplicate processing)
        const latestChapter = quest.chapters[0];
        if (latestChapter && latestChapter.chapterNumber > quest.currentChapter) {
          this.logger.log(`Skipping quest ${quest.shortId} - already processed (current: ${quest.currentChapter}, latest: ${latestChapter.chapterNumber})`);

          // Update the quest's currentChapter to match the latest chapter
          await this.prisma.quest.update({
            where: { id: quest.id },
            data: { currentChapter: latestChapter.chapterNumber },
          });
          continue;
        }

        this.logger.log(`Processing stuck quest ${quest.shortId} (chapter ${quest.currentChapter})`);
        await this.collectVotesAndProgressChapter(quest.id, quest.currentChapter);
      }

      this.logger.log('Finished processing stuck quests');
    } catch (error) {
      this.logger.error(`Failed to recover stuck quests: ${error.message}`);
    }
  }

  async evaluateAndStartQuest(
    tweetId: string,
    mentionTweetId: string,
    conversationId: string | undefined,
    tweetText: string,
    authorHandle: string,
  ): Promise<{ started: boolean; questId?: string; message?: string }> {
    this.logger.log(
      `Evaluating quest potential for tweet ${tweetId} from @${authorHandle}`,
    );

    try {
      // Check if there's already an active quest for this conversation
      if (conversationId) {
        const existingQuest = await this.prisma.quest.findFirst({
          where: {
            tweetId: conversationId,
            status: 'ACTIVE',
          },
          include: {
            chapters: {
              orderBy: { chapterNumber: 'asc' },
            },
          },
        });

        if (existingQuest) {
          // Check if they're replying to a chapter tweet (voting) or the original tweet
          const isReplyingToChapter = existingQuest.chapters.some(
            (chapter) => chapter.postedTweetId === tweetId,
          );

          if (isReplyingToChapter) {
            // They're voting on a chapter, don't send "quest already running" message
            this.logger.log(
              `User is voting on quest ${existingQuest.id}, ignoring duplicate detection`,
            );
            return {
              started: false,
              message: 'User is voting',
            };
          }

          // They're tagging the bot at the original tweet or elsewhere - send the message
          this.logger.log(
            `Quest ${existingQuest.id} already active for conversation ${conversationId}`,
          );

          const chapter1 = existingQuest.chapters.find((ch) => ch.chapterNumber === 1);
          if (chapter1) {
            // Generate unique reply using Grok and post it
            const replyText = await this.grok.generateQuestAlreadyRunningReply(
              existingQuest.shortId,
              chapter1.postedTweetId,
              tweetText,
            );
            await this.tweets.replyToTweetAsBot(mentionTweetId, replyText);
          }

          return {
            started: false,
            message: 'Quest already active',
          };
        }
      }

      const evaluation = await this.grok.evaluateGameWorthiness(tweetText);

      if (!evaluation.hasGamePotential) {
        this.logger.log(`Quest rejected: ${evaluation.reason}`);

        // Use Grok-generated rejection message (always generated, never hardcoded)
        const rejectionMessage = evaluation.rejectionMessage!;
        await this.tweets.replyToTweetAsBot(mentionTweetId, rejectionMessage);

        return {
          started: false,
          message: rejectionMessage,
        };
      }

      this.logger.log(`Quest approved! Starting game...`);

      const questId = await this.createQuest(
        tweetId,
        mentionTweetId,
        tweetText,
        authorHandle,
        evaluation.initialContext,
      );

      return {
        started: true,
        questId,
      };
    } catch (error) {
      this.logger.error(`Failed to evaluate/start quest: ${error.message}`);
      throw error;
    }
  }

  private async createQuest(
    tweetId: string,
    mentionTweetId: string,
    tweetText: string,
    authorHandle: string,
    context?: {
      topic: string;
      historicalParallels: string[];
      conflictPoints: string[];
    },
  ): Promise<string> {
    this.logger.log(`Creating quest for tweet ${tweetId}`);

    const shortId = nanoid(8);

    const scenario = await this.grok.generateQuestScenario(tweetText, context);

    const quest = await this.prisma.quest.create({
      data: {
        shortId,
        initialTweet: tweetText,
        tweetId,
        currentChapter: 1,
        currentState: {
          context,
          canonTitle: scenario.canonTitle,
          scenario: scenario.scenario,
          options: scenario.options,
        } as any,
        status: 'ACTIVE',
      },
    });

    const chapter = await this.prisma.chapter.create({
      data: {
        questId: quest.id,
        chapterNumber: 1,
        chapterTitle: scenario.canonTitle,
        content: scenario.scenario,
        options: scenario.options as any,
        sources: scenario.sources as any,
        postedTweetId: '',
      },
    });

    const chapterText = this.formatChapterTweet(
      1,
      scenario.scenario,
      scenario.options,
      shortId,
      scenario.canonTitle,
    );

    // Generate image for Chapter 1
    this.logger.log('Generating image for Chapter 1...');
    const imageUrl = await this.grok.generateChapterImage(
      scenario.canonTitle,
      scenario.scenario,
    );

    if (imageUrl) {
      this.logger.log(`Chapter 1 image generated: ${imageUrl}`);
    } else {
      this.logger.warn('Failed to generate image for Chapter 1, posting without image');
    }

    // Reply to the mention tweet (where they tagged @xRPGBot), not the evaluated tweet
    const postedTweet = await this.tweets.replyToTweetAsBot(
      mentionTweetId,
      chapterText,
      imageUrl || undefined,
    );

    await this.prisma.chapter.update({
      where: { id: chapter.id },
      data: { postedTweetId: postedTweet.data.id },
    });

    await this.prisma.quest.update({
      where: { id: quest.id },
      data: {
        lastPostedTweetId: postedTweet.data.id,
        chapterDeadline: new Date(Date.now() + 120 * 1000),
      },
    });

    this.logger.log(`Chapter 1 posted. Scheduling vote collection in 2 minutes`);

    if (this.chapterProgressionQueue) {
      await this.chapterProgressionQueue.add(
        'collect-votes',
        { questId: quest.id, chapterNumber: 1 },
        { delay: 180 * 1000 },
      );
    }

    return quest.id;
  }

  private formatChapterTweet(
    chapterNumber: number,
    content: string,
    options: Array<{ text: string; label: string; description?: string }> | null,
    shortId: string,
    canonTitle?: string,
  ): string {
    if (chapterNumber === 5 || !options || options.length === 0) {
      // Final chapter - no choices
      return `${canonTitle ? `📜 ${canonTitle.toUpperCase()}\n\n` : ''}${content}\n\n—\n\nThe timeline has spoken.\n📖 Full story: https://xrpg.gg/s/${shortId}`;
    }

    // Regular chapter with choices - show option name and description
    const choicesList = options
      .map((opt, idx) => {
        const desc = opt.description ? ` — ${opt.description}` : '';
        return `${idx + 1}. ${opt.text}${desc}`;
      })
      .join('\n\n');

    return `${canonTitle && chapterNumber === 1 ? `📜 ${canonTitle.toUpperCase()}\n\n` : ''}${content}\n\n${choicesList}\n\nReply with 1 or 2 to vote.\n\nVoting ends in 2 min.\n📖 https://xrpg.gg/s/${shortId}`;
  }

  async collectVotesAndProgressChapter(
    questId: string,
    chapterNumber: number,
  ): Promise<void> {
    this.logger.log(
      `Collecting votes for Quest ${questId}, Chapter ${chapterNumber}`,
    );

    try {
      const quest = await this.prisma.quest.findUnique({
        where: { id: questId },
        include: {
          chapters: {
            where: { chapterNumber },
            include: { votes: true },
          },
        },
      });

      if (!quest) {
        this.logger.error(`Quest ${questId} not found`);
        return;
      }

      const chapter = quest.chapters[0];
      if (!chapter) {
        this.logger.error(`Chapter ${chapterNumber} not found for quest ${questId}`);
        return;
      }

      const replies = await this.tweets.getReplies(
        chapter.postedTweetId,
        quest.chapterDeadline || undefined,
      );

      this.logger.log(`Collected ${replies.length} replies`);

      const options = chapter.options as Array<{ text: string; label: string }>;

      const voteAnalysis = await this.grok.parsePlayerReplies(
        replies.map((r) => ({
          userId: r.author_username,
          tweetText: r.text,
          tweetId: r.id,
        })),
        options,
      );

      // Create a map of username to tweetId for quick lookup
      const userToTweetMap = new Map(
        replies.map((r) => [r.author_username, r.id]),
      );

      for (const vote of voteAnalysis.voteAnalysis) {
        let user = await this.prisma.user.findUnique({
          where: { xHandle: vote.userId },
        });

        if (!user) {
          user = await this.prisma.user.create({
            data: {
              xHandle: vote.userId,
            },
          });
        }

        // Get the actual tweet ID from the map
        const replyTweetId = userToTweetMap.get(vote.userId) || vote.userId;

        await this.prisma.chapterVote.create({
          data: {
            chapterId: chapter.id,
            userId: user.id,
            selectedOption: vote.selectedOption,
            replyText: vote.replyText,
            replyTweetId: replyTweetId,
            grokInterpretation: vote.interpretation,
          },
        });
      }

      const winningOption = voteAnalysis.winningOption;
      this.logger.log(`Winning option: ${winningOption}`);

      if (chapterNumber < 5) {
        await this.generateNextChapter(
          questId,
          chapterNumber + 1,
          winningOption,
          chapter.id,
        );
      } else {
        await this.completeQuest(questId);
      }
    } catch (error) {
      this.logger.error(
        `Failed to collect votes for quest ${questId}: ${error.message}`,
      );
    }
  }

  private async generateNextChapter(
    questId: string,
    nextChapterNumber: number,
    previousWinningOption: number,
    previousChapterId: string,
  ): Promise<void> {
    this.logger.log(
      `Generating Chapter ${nextChapterNumber} for Quest ${questId}`,
    );

    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
      include: {
        chapters: {
          orderBy: { chapterNumber: 'asc' },
        },
      },
    });

    if (!quest) {
      this.logger.error(`Quest ${questId} not found`);
      return;
    }

    const previousChapters = quest.chapters.map((ch, idx) => ({
      chapterNumber: ch.chapterNumber,
      content: ch.content,
      selectedOption:
        idx === ch.chapterNumber - 1 ? previousWinningOption : undefined,
      sources: ch.sources as any,
    }));

    // Check if chapter already exists (prevent duplicates from job retries)
    const existingChapter = await this.prisma.chapter.findFirst({
      where: {
        questId: quest.id,
        chapterNumber: nextChapterNumber,
      },
    });

    if (existingChapter) {
      this.logger.warn(
        `Chapter ${nextChapterNumber} already exists for quest ${questId}, skipping generation`,
      );
      return;
    }

    const nextChapter = await this.grok.generateNextChapter(
      previousChapters,
      previousWinningOption,
      nextChapterNumber,
    );

    const chapter = await this.prisma.chapter.create({
      data: {
        questId: quest.id,
        chapterNumber: nextChapterNumber,
        chapterTitle: nextChapter.chapterTitle,
        content: nextChapter.content,
        options: (nextChapter.options || []) as any,
        sources: nextChapter.sources as any,
        postedTweetId: '',
      },
    });

    // Get canon title from quest state for reference (only shown in Chapter 1)
    const questState = quest.currentState as any;
    const canonTitle = questState?.canonTitle;

    const chapterText = this.formatChapterTweet(
      nextChapterNumber,
      nextChapter.content,
      nextChapter.options || null,
      quest.shortId,
      canonTitle,
    );

    const postedTweet = await this.tweets.replyToTweetAsBot(
      quest.lastPostedTweetId!,
      chapterText,
    );

    await this.prisma.chapter.update({
      where: { id: chapter.id },
      data: { postedTweetId: postedTweet.data.id },
    });

    // Notify users whose vote won
    await this.notifyWinningVoters(
      previousChapterId,
      previousWinningOption,
      postedTweet.data.id,
      nextChapterNumber,
    );

    // If this is the final chapter (chapter 5), complete the quest immediately
    if (nextChapterNumber === 5) {
      await this.prisma.quest.update({
        where: { id: quest.id },
        data: {
          lastPostedTweetId: postedTweet.data.id,
          currentChapter: nextChapterNumber,
          status: 'COMPLETED',
          chapterDeadline: null,
        },
      });

      this.logger.log(`Final chapter posted. Quest ${quest.id} marked as COMPLETED`);
    } else {
      await this.prisma.quest.update({
        where: { id: quest.id },
        data: {
          lastPostedTweetId: postedTweet.data.id,
          currentChapter: nextChapterNumber,
          chapterDeadline: new Date(Date.now() + 120 * 1000),
        },
      });

      this.logger.log(
        `Chapter ${nextChapterNumber} posted. Scheduling vote collection`,
      );

      if (this.chapterProgressionQueue) {
        await this.chapterProgressionQueue.add(
          'collect-votes',
          { questId: quest.id, chapterNumber: nextChapterNumber },
          { delay: 180 * 1000 },
        );
      }
    }
  }

  private async notifyWinningVoters(
    previousChapterId: string,
    winningOption: number,
    newChapterTweetId: string,
    newChapterNumber: number,
  ): Promise<void> {
    try {
      // Get the chapter to find the winning option text
      const chapter = await this.prisma.chapter.findUnique({
        where: { id: previousChapterId },
      });

      if (!chapter) {
        this.logger.error(`Chapter ${previousChapterId} not found for notification`);
        return;
      }

      const options = chapter.options as Array<{ text: string; label: string }>;
      const winningOptionText = options?.[winningOption - 1]?.text || `Option ${winningOption}`;

      // Get all votes for the previous chapter
      const votes = await this.prisma.chapterVote.findMany({
        where: {
          chapterId: previousChapterId,
          selectedOption: winningOption,
        },
        include: {
          user: true,
        },
      });

      if (votes.length === 0) {
        this.logger.log('No winning voters to notify');
        return;
      }

      this.logger.log(
        `Notifying ${votes.length} users whose vote won`,
      );

      // Generate ONE unique notification using Grok (same for all winners this chapter)
      const notificationText = await this.grok.generateVoteWinNotification(
        newChapterNumber,
        newChapterTweetId,
        winningOptionText,
      );

      // Reply to each winning voter with the generated message
      for (const vote of votes) {
        try {
          await this.tweets.replyToTweetAsBot(
            vote.replyTweetId,
            notificationText,
          );
          this.logger.log(`Notified user ${vote.user.xHandle}`);
        } catch (error) {
          this.logger.error(
            `Failed to notify user ${vote.user.xHandle}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to notify winning voters: ${error.message}`);
    }
  }

  private async completeQuest(questId: string): Promise<void> {
    this.logger.log(`Completing Quest ${questId}`);

    await this.prisma.quest.update({
      where: { id: questId },
      data: {
        status: 'COMPLETED',
      },
    });

    this.logger.log(`Quest ${questId} marked as COMPLETED`);
  }

  async getActiveQuests(
    limit: number = 5,
    offset: number = 0,
  ): Promise<{
    quests: Array<{
      id: string;
      shortId: string;
      initialTweet: string;
      tweetId: string;
      currentChapter: number;
      createdAt: Date;
      chapterDeadline: Date | null;
    }>;
    total: number;
    hasMore: boolean;
  }> {
    const [quests, total] = await Promise.all([
      this.prisma.quest.findMany({
        where: {
          status: 'ACTIVE',
        },
        select: {
          id: true,
          shortId: true,
          initialTweet: true,
          tweetId: true,
          currentChapter: true,
          createdAt: true,
          chapterDeadline: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
        skip: offset,
      }),
      this.prisma.quest.count({
        where: {
          status: 'ACTIVE',
        },
      }),
    ]);

    return {
      quests,
      total,
      hasMore: offset + quests.length < total,
    };
  }

  async getCompletedQuests(
    limit: number = 5,
    offset: number = 0,
  ): Promise<{
    quests: Array<{
      id: string;
      shortId: string;
      initialTweet: string;
      tweetId: string;
      currentChapter: number;
      createdAt: Date;
      updatedAt: Date;
      currentState: any;
    }>;
    total: number;
    hasMore: boolean;
  }> {
    const [quests, total] = await Promise.all([
      this.prisma.quest.findMany({
        where: {
          status: 'COMPLETED',
        },
        select: {
          id: true,
          shortId: true,
          initialTweet: true,
          tweetId: true,
          currentChapter: true,
          createdAt: true,
          updatedAt: true,
          currentState: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
        take: limit,
        skip: offset,
      }),
      this.prisma.quest.count({
        where: {
          status: 'COMPLETED',
        },
      }),
    ]);

    return {
      quests,
      total,
      hasMore: offset + quests.length < total,
    };
  }

  async getQuestByShortId(shortId: string) {
    const quest = await this.prisma.quest.findUnique({
      where: { shortId },
      include: {
        chapters: {
          orderBy: { chapterNumber: 'asc' },
          include: {
            votes: {
              include: {
                user: {
                  select: {
                    xHandle: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!quest) {
      return null;
    }

    return quest;
  }

  async submitVote(
    xHandle: string,
    accessToken: string,
    chapterId: string,
    optionIndex: number,
    tweetId: string,
  ): Promise<{ success: boolean; tweetId?: string }> {
    this.logger.log(`User ${xHandle} voting option ${optionIndex} on chapter ${chapterId}`);

    // Get the chapter to find the options
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: {
        quest: true,
      },
    });

    if (!chapter) {
      throw new Error('Chapter not found');
    }

    if (chapter.quest.status !== 'ACTIVE') {
      throw new Error('Quest is not active');
    }

    const options = chapter.options as Array<{ text: string; label: string }>;
    if (!options || optionIndex < 1 || optionIndex > options.length) {
      throw new Error('Invalid option');
    }

    // Check if user already voted on this chapter
    const existingVote = await this.prisma.chapterVote.findFirst({
      where: {
        chapterId,
        user: {
          xHandle,
        },
      },
    });

    if (existingVote) {
      throw new Error('You have already voted on this chapter');
    }

    // Get the selected option text
    const selectedOption = options[optionIndex - 1];

    // Generate a creative vote reply using Grok
    const replyText = await this.grok.generateVoteReply(
      selectedOption.text,
      optionIndex,
      chapter.content.substring(0, 200),
    );

    // Post the reply tweet on behalf of the user
    const postedTweet = await this.tweets.replyAsUser(
      accessToken,
      tweetId,
      replyText,
    );

    // Get or create user
    let user = await this.prisma.user.findUnique({
      where: { xHandle },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: { xHandle },
      });
    }

    // Record the vote
    await this.prisma.chapterVote.create({
      data: {
        chapterId,
        userId: user.id,
        selectedOption: optionIndex,
        replyText,
        replyTweetId: postedTweet.data.id,
        grokInterpretation: `User voted for option ${optionIndex}`,
      },
    });

    this.logger.log(`Vote recorded for user ${xHandle}`);

    return {
      success: true,
      tweetId: postedTweet.data.id,
    };
  }
}
