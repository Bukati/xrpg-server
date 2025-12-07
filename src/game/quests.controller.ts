import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  NotFoundException,
  UnauthorizedException,
  Req,
  Res,
} from '@nestjs/common';
import { GameService } from './game.service';
import { AuthService } from '../auth/services/auth.service';
import type { Request, Response } from 'express';

@Controller('quests')
export class QuestsController {
  constructor(
    private readonly gameService: GameService,
    private readonly authService: AuthService,
  ) {}

  @Post(':shortId/vote')
  async vote(
    @Param('shortId') shortId: string,
    @Body() body: { chapterId: string; optionIndex: number; tweetId: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Get user from cookies
    const userCookie = (req as any).cookies?.x_user;
    let accessToken = (req as any).cookies?.x_access_token;
    const refreshToken = (req as any).cookies?.x_refresh_token;

    if (!userCookie || !accessToken) {
      throw new UnauthorizedException('Must be logged in to vote');
    }

    let user: { username: string };
    try {
      user = JSON.parse(userCookie);
    } catch {
      throw new UnauthorizedException('Invalid session');
    }

    // Try to vote, refresh token if expired
    try {
      return await this.gameService.submitVote(
        user.username,
        accessToken,
        body.chapterId,
        body.optionIndex,
        body.tweetId,
      );
    } catch (error) {
      // Check if it's a 401 error (token expired)
      if (
        error.message?.includes('401') ||
        error.message?.includes('Unauthorized')
      ) {
        if (!refreshToken) {
          throw new UnauthorizedException(
            'Session expired. Please log in again.',
          );
        }

        // Try to refresh the token
        try {
          const newTokens = await this.authService.refreshAccessToken(refreshToken);
          accessToken = newTokens.access_token;

          // Update cookies with new tokens
          res.cookie('x_access_token', newTokens.access_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7200000, // 2 hours
            path: '/',
          });

          if (newTokens.refresh_token) {
            res.cookie('x_refresh_token', newTokens.refresh_token, {
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
              maxAge: 2592000000, // 30 days
              path: '/',
            });
          }

          // Retry the vote with new token
          return await this.gameService.submitVote(
            user.username,
            accessToken,
            body.chapterId,
            body.optionIndex,
            body.tweetId,
          );
        } catch (refreshError) {
          throw new UnauthorizedException(
            'Session expired. Please log in again.',
          );
        }
      }

      // Re-throw other errors
      throw error;
    }
  }

  @Get('active')
  async getActiveQuests(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.gameService.getActiveQuests(
      limit ? parseInt(limit, 10) : 5,
      offset ? parseInt(offset, 10) : 0,
    );
    return {
      quests: result.quests.map((quest) => ({
        id: quest.id,
        shortId: quest.shortId,
        initialTweet: quest.initialTweet,
        tweetId: quest.tweetId,
        tweetUrl: `https://x.com/i/status/${quest.tweetId}`,
        gameUrl: `/s/${quest.shortId}`,
        currentChapter: quest.currentChapter,
        createdAt: quest.createdAt,
        chapterDeadline: quest.chapterDeadline,
      })),
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  @Get('completed')
  async getCompletedQuests(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.gameService.getCompletedQuests(
      limit ? parseInt(limit, 10) : 5,
      offset ? parseInt(offset, 10) : 0,
    );
    return {
      quests: result.quests.map((quest) => ({
        id: quest.id,
        shortId: quest.shortId,
        initialTweet: quest.initialTweet,
        tweetId: quest.tweetId,
        tweetUrl: `https://x.com/i/status/${quest.tweetId}`,
        gameUrl: `/s/${quest.shortId}`,
        canonTitle: (quest.currentState as any)?.canonTitle,
        currentChapter: quest.currentChapter,
        createdAt: quest.createdAt,
        completedAt: quest.updatedAt,
      })),
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  @Get(':shortId')
  async getQuestByShortId(@Param('shortId') shortId: string) {
    const quest = await this.gameService.getQuestByShortId(shortId);

    if (!quest) {
      throw new NotFoundException(`Quest with shortId ${shortId} not found`);
    }

    const questState = quest.currentState as any;

    return {
      id: quest.id,
      shortId: quest.shortId,
      status: quest.status,
      initialTweet: quest.initialTweet,
      tweetId: quest.tweetId,
      tweetUrl: `https://x.com/i/status/${quest.tweetId}`,
      canonTitle: questState?.canonTitle,
      currentChapter: quest.currentChapter,
      chapterDeadline: quest.chapterDeadline,
      createdAt: quest.createdAt,
      chapters: quest.chapters.map((chapter, index) => {
        // Calculate winning option for past chapters
        const isPast = chapter.chapterNumber < quest.currentChapter;
        let winningOption: number | undefined;

        if (isPast && chapter.votes.length > 0) {
          const voteCounts: Record<number, number> = {};
          for (const vote of chapter.votes) {
            voteCounts[vote.selectedOption] =
              (voteCounts[vote.selectedOption] || 0) + 1;
          }
          winningOption = Number(
            Object.entries(voteCounts).sort((a, b) => b[1] - a[1])[0]?.[0],
          );
        }

        return {
          id: chapter.id,
          chapterNumber: chapter.chapterNumber,
          chapterTitle: chapter.chapterTitle,
          content: chapter.content,
          options: chapter.options,
          sources: chapter.sources,
          postedTweetId: chapter.postedTweetId,
          tweetUrl: `https://x.com/xRPGBot/status/${chapter.postedTweetId}`,
          voteCount: chapter.votes.length,
          createdAt: chapter.createdAt,
          winningOption,
          votes: chapter.votes.map((vote) => ({
            id: vote.id,
            selectedOption: vote.selectedOption,
            user: {
              xHandle: vote.user.xHandle,
            },
          })),
        };
      }),
    };
  }
}
