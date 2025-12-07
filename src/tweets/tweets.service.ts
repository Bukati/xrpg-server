import { Injectable } from '@nestjs/common';
import { Client, OAuth1 } from '@xdevplatform/xdk';

interface TweetData {
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
}

@Injectable()
export class TweetsService {
  private readonly consumerKey = process.env.X_API_CONSUMER_KEY;
  private readonly consumerSecret = process.env.X_API_CONSUMER_SECRET;
  private readonly accessToken = process.env.X_ACCESS_TOKEN;
  private readonly accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;
  private readonly bearerToken = process.env.X_BEARER_TOKEN;

  /**
   * Post a tweet as a user (using their OAuth 2.0 access token)
   */
  async postTweet(accessToken: string, text: string): Promise<any> {
    // Create X client with user's access token (OAuth 2.0)
    const client = new Client({
      accessToken: accessToken,
    });

    // Post the tweet using the posts.create method
    const response = await client.posts.create({
      text,
    });

    return response;
  }

  /**
   * Post a tweet as the bot (using OAuth 1.0a via XDK)
   */
  async postTweetAsBot(text: string): Promise<any> {
    // Create OAuth1 instance with bot credentials
    const oauth1 = new OAuth1({
      apiKey: this.consumerKey!,
      apiSecret: this.consumerSecret!,
      callback: 'oob', // Out-of-band (not needed since we already have access tokens)
      accessToken: this.accessToken!,
      accessTokenSecret: this.accessTokenSecret!,
    });

    // Create X client with OAuth 1.0a
    const client = new Client({
      oauth1,
    });

    // Post the tweet using the XDK client
    const response = await client.posts.create({
      text,
    });

    return response;
  }

  /**
   * Upload an image to Twitter and get media ID
   */
  async uploadImage(imageUrl: string): Promise<string | null> {
    try {
      console.log('[Image Upload] Starting upload for:', imageUrl);

      // Step 1: Download the image from the URL
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        console.error('[Image Upload] Failed to download image:', imageResponse.statusText);
        return null;
      }

      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      console.log('[Image Upload] Downloaded image, size:', imageBuffer.length, 'bytes');

      // Step 2: Create OAuth1 instance for signing
      const oauth1 = new OAuth1({
        apiKey: this.consumerKey!,
        apiSecret: this.consumerSecret!,
        callback: 'oob',
        accessToken: this.accessToken!,
        accessTokenSecret: this.accessTokenSecret!,
      });

      // Step 3: Create X client with OAuth 1.0a
      const client = new Client({
        oauth1,
      });

      // Step 4: Upload using XDK Client's media upload if available
      // If XDK doesn't support media upload, we'll use raw API call
      try {
        // Try using client.media.upload if it exists
        const mediaUpload = (client as any).media?.upload;
        if (mediaUpload) {
          const result = await mediaUpload({
            media: imageBuffer,
          });
          console.log('[Image Upload] Success via XDK:', result.media_id_string);
          return result.media_id_string;
        }
      } catch (xdkError) {
        console.log('[Image Upload] XDK media upload not available, using raw API');
      }

      // Step 5: Use Twitter API v2 client for media upload
      // Import TwitterApi for media upload
      const { TwitterApi } = await import('twitter-api-v2');

      const twitterClient = new TwitterApi({
        appKey: this.consumerKey!,
        appSecret: this.consumerSecret!,
        accessToken: this.accessToken!,
        accessSecret: this.accessTokenSecret!,
      });

      try {
        const mediaId = await twitterClient.v1.uploadMedia(imageBuffer, {
          mimeType: 'image/png',
        });
        console.log('[Image Upload] Success:', mediaId);
        return mediaId;
      } catch (uploadError) {
        console.error('[Image Upload] Failed to upload:', uploadError.message);
        return null;
      }
    } catch (error) {
      console.error('[Image Upload] Error:', error.message);
      return null;
    }
  }

  /**
   * Reply to a tweet as the bot (using OAuth 1.0a via XDK)
   */
  async replyToTweetAsBot(
    tweetId: string,
    text: string,
    imageUrl?: string,
  ): Promise<any> {
    // Create OAuth1 instance with bot credentials
    const oauth1 = new OAuth1({
      apiKey: this.consumerKey!,
      apiSecret: this.consumerSecret!,
      callback: 'oob', // Out-of-band (not needed since we already have access tokens)
      accessToken: this.accessToken!,
      accessTokenSecret: this.accessTokenSecret!,
    });

    // Create X client with OAuth 1.0a
    const client = new Client({
      oauth1,
    });

    // Upload image if provided
    let mediaId: string | undefined;
    if (imageUrl) {
      mediaId = (await this.uploadImage(imageUrl)) || undefined;
    }

    // Reply to the tweet using the XDK client
    const response = await client.posts.create({
      text,
      reply: {
        in_reply_to_tweet_id: tweetId,
      },
      ...(mediaId && {
        media: {
          media_ids: [mediaId],
        },
      }),
    });

    return response;
  }

  /**
   * Reply to a tweet as a specific user (using their OAuth 2.0 access token)
   */
  async replyAsUser(
    userAccessToken: string,
    tweetId: string,
    text: string,
  ): Promise<any> {
    // Create X client with user's OAuth 2.0 access token
    const client = new Client({
      accessToken: userAccessToken,
    });

    // Reply to the tweet
    const response = await client.posts.create({
      text,
      reply: {
        in_reply_to_tweet_id: tweetId,
      },
    });

    return response;
  }

  /**
   * Fetch tweet information by ID (using Bearer token)
   */
  async getTweet(tweetId: string): Promise<TweetData | null> {
    if (!this.bearerToken) {
      throw new Error('X_BEARER_TOKEN not configured');
    }

    try {
      const response = await fetch(
        `https://api.x.com/2/tweets/${tweetId}?tweet.fields=created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.bearerToken}`,
          },
        },
      );

      if (!response.ok) {
        const error = await response.text();
        console.error(`Failed to fetch tweet ${tweetId}:`, error);
        return null;
      }

      const result = await response.json();
      return result.data;
    } catch (error) {
      console.error(`Error fetching tweet ${tweetId}:`, error.message);
      return null;
    }
  }

  /**
   * Get the parent tweet if this tweet is a reply
   */
  async getParentTweet(tweet: TweetData): Promise<TweetData | null> {
    // Check if this tweet is a reply
    const replyToTweet = tweet.referenced_tweets?.find((ref) => ref.type === 'replied_to');

    if (!replyToTweet) {
      return null;
    }

    // Fetch the parent tweet
    return this.getTweet(replyToTweet.id);
  }

  /**
   * Get replies to a tweet (for vote collection)
   * Gets direct replies to the specified tweet, excluding replies to other tweets in the thread
   */
  async getReplies(
    tweetId: string,
    sinceTime?: Date,
  ): Promise<Array<{ id: string; text: string; author_id: string }>> {
    if (!this.bearerToken) {
      throw new Error('X_BEARER_TOKEN not configured');
    }

    try {
      // Search for tweets that are direct replies to this specific tweet
      // This automatically excludes replies to previous/next chapters
      const query = `in_reply_to_tweet_id:${tweetId}`;

      // Use search/recent endpoint to find direct replies
      const params = new URLSearchParams({
        query,
        'tweet.fields': 'author_id,created_at,in_reply_to_user_id',
        max_results: '100',
      });

      const response = await fetch(
        `https://api.x.com/2/tweets/search/recent?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.bearerToken}`,
          },
        },
      );

      if (!response.ok) {
        const error = await response.text();
        console.error(`Failed to fetch replies:`, error);
        return [];
      }

      const result = await response.json();

      if (!result.data || result.data.length === 0) {
        return [];
      }

      // Return all direct replies
      return result.data.map((t: any) => ({
        id: t.id,
        text: t.text,
        author_id: t.author_id,
      }));
    } catch (error) {
      console.error(`Error fetching replies:`, error.message);
      return [];
    }
  }
}
