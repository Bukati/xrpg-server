import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { FilteredStreamService } from './filtered-stream.service';

@Injectable()
export class PersistentStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly bearerToken = process.env.X_BEARER_TOKEN;
  private abortController: AbortController | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly baseDelay = 1000; // 1 second
  private isShuttingDown = false;

  constructor(private readonly filteredStreamService: FilteredStreamService) {}

  onModuleInit() {
    console.log('🔄 Starting persistent filtered stream connection...');
    // Don't await - let the stream run in the background so the server can start
    this.connect().catch((error) => {
      console.error('❌ Failed to start persistent stream:', error.message);
    });
  }

  async onModuleDestroy() {
    console.log('🛑 Shutting down persistent stream connection...');
    this.isShuttingDown = true;
    this.disconnect();
    // Wait a bit to ensure the connection is fully closed before a new instance can connect
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  private async connect(): Promise<void> {
    if (!this.bearerToken) {
      console.error('❌ X_BEARER_TOKEN not configured');
      return;
    }

    if (this.isShuttingDown) {
      return;
    }

    this.abortController = new AbortController();

    try {
      console.log('🌐 Connecting to filtered stream...');

      const response = await fetch(
        'https://api.x.com/2/tweets/search/stream?tweet.fields=created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets&expansions=author_id,referenced_tweets.id&user.fields=username,name',
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.bearerToken}`,
          },
          signal: this.abortController.signal,
        },
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to connect to stream (${response.status}): ${error}`);
      }

      console.log('✅ Connected to filtered stream!');
      this.reconnectAttempts = 0;

      // Read the stream
      await this.readStream(response);
    } catch (error) {
      if (this.isShuttingDown) {
        return;
      }

      console.error('❌ Stream connection error:', error.message);
      await this.handleReconnect();
    }
  }

  private async readStream(response: Response): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body reader available');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (!this.isShuttingDown) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('📡 Stream ended, reconnecting...');
          await this.handleReconnect();
          return;
        }

        // Decode chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines (newline-delimited JSON)
        const lines = buffer.split('\r\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const event = JSON.parse(line);
              await this.processEvent(event);
            } catch (error) {
              console.error('❌ Error parsing stream event:', error.message);
              console.log('Raw line:', line);
            }
          }
        }
      }
    } catch (error) {
      if (!this.isShuttingDown) {
        console.error('❌ Error reading stream:', error.message);
        await this.handleReconnect();
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async processEvent(event: any): Promise<void> {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📨 FILTERED STREAM EVENT RECEIVED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Event:', JSON.stringify(event, null, 2));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      await this.filteredStreamService.processStreamEvent(event);
      console.log('✅ Event processed successfully');
    } catch (error) {
      console.error('❌ Error processing event:', error.message);
    }
  }

  private async handleReconnect(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error(`❌ Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = this.baseDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`⏳ Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    await new Promise((resolve) => setTimeout(resolve, delay));
    await this.connect();
  }

  private disconnect(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
