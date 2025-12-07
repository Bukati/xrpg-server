import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { TweetsService } from './tweets.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import type { AuthenticatedUser } from '../auth/guards/auth.guard';
import { User } from '../auth/decorators/user.decorator';

@Controller('tweets')
@UseGuards(AuthGuard)
export class TweetsController {
  constructor(private readonly tweetsService: TweetsService) {}

  @Post()
  async postTweet(
    @User() user: AuthenticatedUser,
    @Body() body: { text: string },
  ) {
    try {
      if (!body.text || body.text.trim().length === 0) {
        throw new HttpException(
          'Tweet text cannot be empty',
          HttpStatus.BAD_REQUEST,
        );
      }

      const response = await this.tweetsService.postTweet(
        user.accessToken,
        body.text,
      );

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error('Error posting tweet:', error);
      throw new HttpException(
        error.message || 'Failed to post tweet',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
