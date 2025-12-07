import { Injectable, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { TweetsService } from '../tweets/tweets.service';

interface FilteredStreamEvent {
  data: {
    id: string;
    text: string;
    author_id: string;
    created_at?: string;
    conversation_id?: string;
    in_reply_to_user_id?: string;
    referenced_tweets?: Array<{
      type: string;
      id: string;
    }>;
  };
  includes?: {
    users?: Array<{
      id: string;
      username: string;
      name: string;
    }>;
  };
  matching_rules?: Array<{
    id: string;
    tag: string;
  }>;
}

@Injectable()
export class FilteredStreamService {
  private readonly botUsername = 'xRPGBot';
  private botUserId: string | null = null;

  constructor(
    private readonly tweetsService: TweetsService,
    @InjectQueue('quest-evaluation') private questEvaluationQueue: Queue,
  ) {}

  /**
   * Get the bot's user ID (cached after first fetch)
   */
  private async getBotUserId(): Promise<string | null> {
    if (this.botUserId) {
      return this.botUserId;
    }

    try {
      const user = await this.tweetsService.getUserByUsername(this.botUsername);
      if (user) {
        this.botUserId = user.id;
        console.log(`🤖 Bot user ID cached: ${this.botUserId}`);
      }
      return this.botUserId;
    } catch (error) {
      console.error('Failed to get bot user ID:', error.message);
      return null;
    }
  }

  /**
   * Process incoming filtered stream events
   * These are posts that match our filtering rules (e.g., mentions of @xRPGBot)
   */
  async processStreamEvent(event: FilteredStreamEvent): Promise<void> {
    console.log(
      'Processing filtered stream event:',
      JSON.stringify(event, null, 2),
    );

    const { data, includes, matching_rules } = event;

    if (!data) {
      console.log('No data in event, skipping');
      return;
    }

    const tweet = data;
    const author = includes?.users?.[0];

    if (!author) {
      console.log('No author information, skipping');
      return;
    }

    console.log(`📝 Tweet ID: ${tweet.id}`);
    console.log(`👤 Author: @${author.username} (${author.name})`);
    console.log(`💬 Text: ${tweet.text}`);
    console.log(`📊 Matching rules:`, matching_rules);

    // Avoid processing tweets from the bot itself
    if (author.username.toLowerCase() === this.botUsername.toLowerCase()) {
      console.log('Tweet from bot account, skipping');
      return;
    }

    console.log('🎮 Bot mentioned! Starting xRPG quest evaluation...');

    try {
      // Fetch parent tweet if this is a reply (the tweet to be evaluated for the game)
      const replyToTweet = tweet.referenced_tweets?.find(
        (ref) => ref.type === 'replied_to',
      );

      const mentionTweetId = tweet.id; // Where they tagged the bot
      let tweetText = tweet.text;
      let tweetId = tweet.id; // Tweet to evaluate for game
      let conversationId = tweet.conversation_id;

      if (replyToTweet) {
        console.log(
          `📎 This is a reply to tweet ${replyToTweet.id}, fetching parent...`,
        );
        const parentTweet = await this.tweetsService.getTweet(replyToTweet.id);

        if (parentTweet) {
          // Check if they're replying to the bot's own tweet (voting on a chapter)
          // The bot's user ID can be identified by checking if the parent tweet author matches the bot
          if (tweet.in_reply_to_user_id === parentTweet.author_id &&
              parentTweet.author_id === await this.getBotUserId()) {
            console.log('🗳️ This is a reply to a bot tweet (likely a vote), skipping quest evaluation');
            return;
          }

          console.log('📄 Evaluating parent tweet for game worthiness');
          tweetText = parentTweet.text;
          tweetId = parentTweet.id;
          conversationId = parentTweet.conversation_id || conversationId;
        } else {
          console.log('⚠️ Could not fetch parent tweet, using mention tweet');
        }
      } else {
        console.log(
          'ℹ️ This is a direct mention, evaluating the mention tweet itself',
        );
      }

      console.log(`🎲 Queueing quest evaluation for tweet ${tweetId}`);
      console.log(`📝 Tweet text: "${tweetText}"`);
      console.log(`💬 Reply will go to mention tweet: ${mentionTweetId}`);

      // Queue the quest evaluation job
      await this.questEvaluationQueue.add('evaluate-quest', {
        tweetId, // Tweet to evaluate
        mentionTweetId, // Where to reply
        conversationId, // For checking existing quests
        tweetText,
        authorHandle: author.username,
      });

      console.log('✅ Quest evaluation job queued successfully');
    } catch (error) {
      console.error('❌ Error queueing quest evaluation:', error.message);
    }
  }
}
