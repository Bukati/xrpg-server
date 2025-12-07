import { Injectable, OnModuleInit } from '@nestjs/common';

interface StreamRule {
  id?: string;
  value: string;
  tag: string;
}

@Injectable()
export class StreamRulesService implements OnModuleInit {
  private readonly bearerToken = process.env.X_BEARER_TOKEN;

  async onModuleInit() {
    console.log('🔄 Initializing X Filtered Stream Rules...');

    // Auto-setup rules on startup
    await this.ensureRules();

    console.log('✅ X Filtered Stream rules configured');
  }

  /**
   * Ensure filtering rules are set up
   * Rules define which tweets to receive (e.g., mentions of @xRPGBot)
   */
  async ensureRules(): Promise<void> {
    if (!this.bearerToken) {
      console.error('X_BEARER_TOKEN not configured');
      return;
    }

    console.log('Setting up filtered stream rules...');

    // First, get existing rules
    const existingRules = await this.listRules();

    // Define desired rules
    const desiredRules: StreamRule[] = [
      {
        value: '@xRPGBot -is:retweet',
        tag: 'xRPGBot_mentions',
      },
    ];

    // Delete existing rules if any
    if (existingRules && existingRules.length > 0) {
      console.log(`Found ${existingRules.length} existing rules, deleting...`);
      const ruleIds = existingRules
        .map((r) => r.id)
        .filter((id): id is string => !!id);
      if (ruleIds.length > 0) {
        await this.deleteRules(ruleIds);
      }
    }

    // Add new rules
    await this.addRules(desiredRules);
  }

  /**
   * List all active filtering rules
   */
  async listRules(): Promise<StreamRule[]> {
    if (!this.bearerToken) {
      console.error('X_BEARER_TOKEN not configured');
      return [];
    }

    try {
      const response = await fetch(
        'https://api.x.com/2/tweets/search/stream/rules',
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.bearerToken}`,
          },
        },
      );

      if (response.ok) {
        const result = await response.json();
        const rules = result.data || [];
        console.log(`📋 Found ${rules.length} active rules:`, rules);
        return rules;
      } else {
        const error = await response.text();
        console.error(`❌ Failed to list rules (${response.status}):`, error);
        return [];
      }
    } catch (error) {
      console.error('❌ Error listing rules:', error.message);
      return [];
    }
  }

  /**
   * Add new filtering rules
   */
  async addRules(rules: StreamRule[]): Promise<void> {
    if (!this.bearerToken) {
      console.error('X_BEARER_TOKEN not configured');
      return;
    }

    console.log('Adding filtering rules:', rules);

    try {
      const response = await fetch(
        'https://api.x.com/2/tweets/search/stream/rules',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.bearerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            add: rules,
          }),
        },
      );

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Rules added successfully:', result);
      } else {
        const error = await response.text();
        console.error(`❌ Failed to add rules (${response.status}):`, error);
      }
    } catch (error) {
      console.error('❌ Error adding rules:', error.message);
    }
  }

  /**
   * Delete filtering rules by ID
   */
  async deleteRules(ruleIds: string[]): Promise<void> {
    if (!this.bearerToken) {
      console.error('X_BEARER_TOKEN not configured');
      return;
    }

    console.log('Deleting rules:', ruleIds);

    try {
      const response = await fetch(
        'https://api.x.com/2/tweets/search/stream/rules',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.bearerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            delete: {
              ids: ruleIds,
            },
          }),
        },
      );

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Rules deleted successfully:', result);
      } else {
        const error = await response.text();
        console.error(`❌ Failed to delete rules (${response.status}):`, error);
      }
    } catch (error) {
      console.error('❌ Error deleting rules:', error.message);
    }
  }
}
