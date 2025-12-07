import { Injectable, Logger } from '@nestjs/common';
import {
  GameWorthinessResult,
  QuestScenario,
  VoteAnalysisResult,
  NextChapter,
  ChapterHistory,
} from './grok.types';

@Injectable()
export class GrokService {
  private readonly logger = new Logger(GrokService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.x.ai/v1';

  constructor() {
    this.apiKey = process.env.GROK_API_KEY!;
    if (!this.apiKey) {
      throw new Error('GROK_API_KEY is not configured');
    }
  }

  private async callGrok(
    messages: Array<{ role: string; content: string }>,
    temperature = 0.7,
  ): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-4-1-fast-reasoning',
          messages,
          temperature,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`Grok API error: ${error}`);
        throw new Error(`Grok API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0]?.message?.content || '';
    } catch (error) {
      this.logger.error(`Failed to call Grok: ${error.message}`);
      throw error;
    }
  }

  private async searchWithGrok(
    query: string,
  ): Promise<{
    content: string;
    citations: string[];
    sources: Array<{ url: string; title: string; excerpt: string }>;
  }> {
    try {
      // Use Parallel AI search instead of Grok
      const parallelApiKey = process.env.PARALLEL_API_KEY;
      if (!parallelApiKey) {
        throw new Error('PARALLEL_API_KEY is not configured');
      }

      const response = await fetch('https://api.parallel.ai/v1beta/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': parallelApiKey,
          'parallel-beta': 'search-extract-2025-10-10',
        },
        body: JSON.stringify({
          mode: 'one-shot',
          search_queries: null,
          max_results: 5,
          objective: query,
          excerpts: {
            max_chars_per_result: 200,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`Parallel AI search error: ${error}`);
        throw new Error(`Parallel AI search error: ${response.status}`);
      }

      const data = await response.json();

      // Log the response structure
      this.logger.log(`Parallel search response: ${JSON.stringify(data).substring(0, 500)}`);

      // Extract content and citations from Parallel AI response
      const results = data.results || [];
      const sources: Array<{ url: string; title: string; excerpt: string }> = [];

      for (const result of results) {
        if (result.url) {
          sources.push({
            url: result.url,
            title: result.title || result.url,
            excerpt: result.excerpt || result.content || '',
          });
        }
      }

      // Also build combined content for backwards compatibility
      const content = sources.map(s => s.excerpt).join('\n\n');
      const citations = sources.map(s => s.url);

      this.logger.log(`Search completed: ${sources.length} sources found`);
      this.logger.log(`Sources: ${JSON.stringify(sources.map(s => ({ url: s.url, title: s.title })))}`);

      return { content, citations, sources };
    } catch (error) {
      this.logger.error(`Failed to search with Parallel AI: ${error.message}`);
      throw error;
    }
  }

  private async findHistoricalSources(
    scenarioContent: string,
    historicalContext: string,
  ): Promise<{ title: string; url: string; relevantFact: string }[]> {
    this.logger.log(`Finding historical sources for factual claims`);

    // First, extract the core factual claims AND themes from the scenario
    const factExtractionQuery = `Extract from this text:
1. Core factual claims (numbers, events, entities, timeframes)
2. Key themes and topics (e.g., labor relations, executive compensation, corporate governance)

Text: "${scenarioContent}"

Remove all opinions and emotional language. List facts and themes concisely.`;

    try {
      // Extract facts and themes first
      const factsResponse = await this.callGrok(
        [
          {
            role: 'system',
            content:
              'Extract factual claims and themes, removing opinions. Be objective.',
          },
          { role: 'user', content: factExtractionQuery },
        ],
        0.3,
      );

      const factualContent = factsResponse.trim();
      this.logger.log(
        `Extracted facts and themes: ${factualContent.substring(0, 100)}`,
      );

      // Multi-angle search strategy using Parallel AI objectives
      let allSources: Array<{ url: string; title: string; excerpt: string }> = [];

      // Search 1: Main topic with historical precedents and both perspectives
      const mainQuery = `Find sources about: ${factualContent}. Include historical precedents, similar cases, arguments in favor (benefits, rationale, supporting evidence), and arguments against (criticisms, opposing views, counterarguments).`;
      try {
        const result = await this.searchWithGrok(mainQuery);
        if (result.sources) {
          allSources.push(...result.sources);
        }
        this.logger.log(`Main search found ${result.sources?.length || 0} sources`);
      } catch (error) {
        this.logger.warn(`Main search failed: ${error.message}`);
      }

      // Search 2: Broader philosophical and historical context with balanced perspectives
      if (allSources.length < 3 && historicalContext) {
        const contextQuery = `Find sources about: ${historicalContext}. Include philosophical perspectives both supporting and opposing this view, historical examples, and ethical considerations from multiple viewpoints.`;
        try {
          const result = await this.searchWithGrok(contextQuery);
          if (result.sources) {
            allSources.push(...result.sources);
          }
          this.logger.log(`Context search found ${result.sources?.length || 0} sources`);
        } catch (error) {
          this.logger.warn(`Context search failed: ${error.message}`);
        }
      }

      // Remove duplicates by URL
      const uniqueSources = allSources.filter(
        (source, index, self) =>
          index === self.findIndex((s) => s.url === source.url),
      );

      this.logger.log(`Total unique sources found: ${uniqueSources.length}`);

      // Take up to 3 sources
      const topSources = uniqueSources.slice(0, 3);

      if (topSources.length === 0) {
        this.logger.error('CRITICAL: No sources found from Parallel AI search');
        this.logger.error('This means the search API failed to return any results');
        throw new Error('Failed to find real sources - Parallel AI returned no results');
      }

      // Map to the expected format with actual titles and excerpts
      const sources = topSources.map((source) => ({
        title: source.title,
        url: source.url,
        relevantFact: source.excerpt.substring(0, 250),
      }));

      this.logger.log(`Found ${sources.length} historical sources`);
      this.logger.log(`Sources: ${JSON.stringify(sources.map(s => s.title))}`);
      return sources;
    } catch (error) {
      this.logger.error(`Failed to find sources: ${error.message}`);
      // Re-throw the error - we ONLY want real sources, no fallbacks
      throw new Error(`Failed to find real historical sources: ${error.message}`);
    }
  }

  async generateChapterImage(
    canonTitle: string,
    scenarioText: string,
  ): Promise<string | null> {
    this.logger.log(`Generating image for: ${canonTitle}`);

    try {
      const prompt = `Create a dramatic, cinematic image representing this scenario:

Title: ${canonTitle}
Scene: ${scenarioText.substring(0, 300)}

Style: Photorealistic, dramatic lighting, corporate/political setting, professional photography, high detail, cinematic composition. Show the tension and stakes of the decision. No text or labels in the image.`;

      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-imagine-v0p9',
          prompt: prompt,
          n: 1,
          response_format: 'url',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`Grok Image API error: ${error}`);
        return null;
      }

      const data = await response.json();
      const imageUrl = data.data?.[0]?.url;

      if (!imageUrl) {
        this.logger.error('No image URL in response');
        return null;
      }

      this.logger.log(`Image generated successfully: ${imageUrl}`);
      return imageUrl;
    } catch (error) {
      this.logger.error(`Failed to generate image: ${error.message}`);
      return null;
    }
  }

  async evaluateGameWorthiness(
    tweetText: string,
  ): Promise<GameWorthinessResult> {
    this.logger.log(`Evaluating game worthiness for tweet: ${tweetText}`);

    const prompt = `You are an expert at identifying controversial, historically significant, and ideologically rich content suitable for a branching narrative game.

Analyze this tweet and determine if it has enough "meat" for a dramatic what-if historical/political simulation game:

Tweet: "${tweetText}"

Criteria for "game-worthy" content:
1. Controversial/spicy takes - strong opinions, divisive statements, opposing viewpoints
2. Historical/political content - references to real events, ideologies, movements
3. What-if potential - can spawn alternative scenarios with real historical parallels
4. Sufficient substance - not just "hello" or trivial content

Respond in JSON format:
{
  "hasGamePotential": boolean,
  "reason": "brief explanation",
  "rejectionMessage": "friendly message if rejected (only if hasGamePotential is false)",
  "initialContext": {
    "topic": "main topic/ideology",
    "historicalParallels": ["historical event 1", "historical event 2"],
    "conflictPoints": ["point of contention 1", "point of contention 2"]
  } (only if hasGamePotential is true)
}`;

    const response = await this.callGrok([
      {
        role: 'system',
        content:
          'You are a JSON-only assistant. Always respond with valid JSON.',
      },
      { role: 'user', content: prompt },
    ]);

    try {
      const result = JSON.parse(response);
      this.logger.log(
        `Game worthiness result: ${result.hasGamePotential ? 'APPROVED' : 'REJECTED'}`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to parse Grok response: ${error.message}`);
      throw new Error('Invalid response from Grok');
    }
  }

  async generateQuestScenario(
    tweetText: string,
    context?: { topic: string; historicalParallels: string[] },
  ): Promise<QuestScenario> {
    this.logger.log(`Generating quest scenario for: ${tweetText}`);

    const contextInfo = context
      ? `\n\nContext: Topic is "${context.topic}". Historical parallels include: ${context.historicalParallels.join(', ')}.`
      : '';

    const currentDate = new Date().toISOString().split('T')[0];

    const prompt = `Today's date is ${currentDate}. Scenarios MUST be set today or in the future - NEVER in the past.

Create Chapter 1 of a high-stakes decision game based on this tweet: "${tweetText}"${contextInfo}

STYLE:
- Casual, punchy, Twitter-native tone
- Second person present tense: "You're in the boardroom. Everyone's staring."
- NO data overload - keep it simple and engaging
- Consequences should be REALISTIC and BALANCED - both options can succeed or fail
- MUST be backed by real historical precedents and sources
- NO inherent bias - unconventional choices can win, safe choices can backfire

STRUCTURE:

1. TITLE: Short, punchy 2-4 word title (e.g., "The CEO Gamble", "Union Showdown")

2. SETUP (60-80 words MAX):
   - Start with year (${currentDate.split('-')[0]} or later) and place: "${currentDate.split('-')[0]} — Seattle."
   - "You're a [role]." (board member, mayor, CEO, etc.)
   - Present the dilemma simply
   - NO statistics, NO percentages, NO detailed data
   - Build tension with realistic stakes
   - End when they need to choose

3. OPTIONS: TWO simple choices - just the ACTION, no consequences revealed
   - Each option: Just the choice/action (3-8 words max)
   - DO NOT reveal consequences - those come in next chapter
   - NO emojis in labels - just plain numbered options
   - Make it a clear, simple decision

Respond in JSON:
{
  "canonTitle": "The [Title]",
  "scenario": "Just the setup - NO options included. Plain text, no markdown.",
  "options": [
    { "text": "Simple action/choice (no consequences)", "label": "1" },
    { "text": "Simple action/choice (no consequences)", "label": "2" }
  ],
  "historicalContext": "Real parallel"
}

EXAMPLE:
Title: "The Pay Fight"
Setup: "${currentDate.split('-')[0]} — Seattle. You're on the Starbucks board. New CEO wants $96M for 4 months. Union workers haven't had a contract in years. The internet is watching."
Option 1: "Approve the CEO package"
Option 2: "Fast-track union contracts"

IMPORTANT:
- Consequences must be REALISTIC and backed by real historical events
- Cite actual examples from history - show BOTH successes AND failures for similar choices
- Sources MUST be real, verifiable links
- BE BALANCED: History shows bold moves sometimes win big (Reagan, Thatcher, tech disruptors) and sometimes fail
- Don't assume conventional = safe or unconventional = risky. Context matters.
- Show trade-offs, not predetermined winners

REMEMBER: Balanced, realistic setup. Both options are viable. Consequences revealed next chapter with real historical backing.`;

    const response = await this.callGrok(
      [
        {
          role: 'system',
          content:
            'You are a JSON-only assistant specialized in historical accuracy. Create BALANCED scenarios where both options are viable - no predetermined losers. Always respond with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      0.8,
    );

    try {
      const result = JSON.parse(response);

      // Fetch real historical sources using the original tweet text for objectivity
      const sources = await this.findHistoricalSources(
        tweetText,
        result.historicalContext || '',
      );

      this.logger.log(
        `Generated scenario with ${result.options.length} options and ${sources.length} sources`,
      );

      return {
        ...result,
        sources,
      };
    } catch (error) {
      this.logger.error(
        `Failed to parse Grok scenario response: ${error.message}`,
      );
      throw new Error('Invalid scenario response from Grok');
    }
  }

  async parsePlayerReplies(
    replies: Array<{ userId: string; tweetText: string; tweetId: string }>,
    options: Array<{ text: string; label: string }>,
  ): Promise<VoteAnalysisResult> {
    this.logger.log(`Parsing ${replies.length} player replies`);

    if (replies.length === 0) {
      return {
        voteAnalysis: [],
        winningOption: 1,
        participationStats: {
          totalReplies: 0,
          uniqueVoters: 0,
          optionBreakdown: { option1: 0, option2: 0, option3: 0 },
        },
      };
    }

    const repliesText = replies
      .map(
        (r, i) =>
          `Reply ${i + 1} (User: ${r.userId}, Tweet ID: ${r.tweetId}):\n${r.tweetText}`,
      )
      .join('\n\n');

    const optionsText = options
      .map((opt, i) => `Option ${i + 1}: ${opt.label} - ${opt.text}`)
      .join('\n');

    const prompt = `You are analyzing player votes for a game. Players can vote by replying with:
- Just the number: "1" or "2"
- The full text of the option
- Any clear reference to the option

Available options:
${optionsText}

Player replies:
${repliesText}

For each reply, determine:
1. Which option (1 or 2) the player is voting for
   - If they reply "1" or "2", that's their vote
   - If they mention keywords from an option's text, count that
   - Be flexible but clear votes get higher weight
2. Your interpretation/reasoning
3. Weight (1.0 = clear vote like "1" or "2", 0.8 = clear text match, 0.5 = ambiguous, 0.1 = unclear)

If multiple replies are from the same user, consider ALL their replies (don't just count the first).

Respond in JSON format:
{
  "voteAnalysis": [
    {
      "userId": "user ID",
      "replyText": "their reply",
      "selectedOption": 1|2,
      "interpretation": "why you think they chose this option",
      "weight": 0.1 to 1.0
    }
  ],
  "winningOption": 1|2,
  "participationStats": {
    "totalReplies": number,
    "uniqueVoters": number,
    "optionBreakdown": {
      "option1": weighted count,
      "option2": weighted count
    }
  }
}`;

    const response = await this.callGrok(
      [
        {
          role: 'system',
          content:
            'You are a JSON-only assistant. Analyze votes carefully and respond with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      0.3,
    );

    try {
      const result = JSON.parse(response);
      this.logger.log(
        `Vote analysis complete. Winner: Option ${result.winningOption}`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to parse vote analysis: ${error.message}`);
      throw new Error('Invalid vote analysis response from Grok');
    }
  }

  async generateNextChapter(
    previousChapters: ChapterHistory[],
    winningOption: number,
    chapterNumber: number,
  ): Promise<NextChapter> {
    this.logger.log(
      `Generating Chapter ${chapterNumber} based on winning option ${winningOption}`,
    );

    const isFinalChapter = chapterNumber === 5;

    const historyText = previousChapters
      .map(
        (ch) =>
          `Chapter ${ch.chapterNumber}:\n${ch.content}\n${ch.selectedOption ? `Selected: Option ${ch.selectedOption}` : ''}`,
      )
      .join('\n\n');

    const currentDate = new Date().toISOString().split('T')[0];

    const prompt = `Today's date is ${currentDate}. All events MUST be set today or in the future - NEVER in the past.

Continue Chapter ${chapterNumber} ${isFinalChapter ? '(FINAL)' : ''} - show what happened after their choice.

STORY SO FAR:
${historyText}

THEIR CHOICE: Option ${winningOption}

${
  isFinalChapter
    ? `FINAL CHAPTER:
- Show the realistic outcome (60-80 words)
- Consequences should be BELIEVABLE and backed by history
- Casual, punchy tone: "Six months later, the results are in."
- NO options - the story ends here
- BALANCED outcomes: the choice could lead to success, partial success, or failure depending on context
- MUST reference real historical outcomes from similar decisions`
    : `NEXT CHAPTER:
- Show realistic fallout from their choice (50-70 words)
- Casual second person: "It happens fast."
- NO data/stats - engaging but REALISTIC
- Build to next tough choice
- TWO new options - just the ACTION, NO consequences revealed
- BALANCED: Their choice isn't automatically good or bad - show nuanced results
- Base consequences on REAL historical precedents`
}

Respond in JSON:
{
  "chapterNumber": ${chapterNumber},
  "chapterTitle": "Short 2-4 word title (e.g., 'Breaking Point', 'The Reckoning', 'Last Stand')",
  "content": "Just the consequences - NO options. Plain text, no markdown.",
  "options": ${isFinalChapter ? 'null' : '[{ "text": "Simple action/choice (no consequences)", "label": "1" }, { "text": "Simple action/choice (no consequences)", "label": "2" }]'},
  "historicalOutcome": "Real parallel",
  "connectionToReality": "Actual precedent"
}

CRITICAL REQUIREMENTS:
- ALL consequences must be based on REAL historical events
- Outcomes should reflect what ACTUALLY happened in similar real-world situations
- BE BALANCED: Bold/unconventional choices have succeeded historically (Brexit, tech disruption, political upsets)
- Don't punish players for "edgy" choices - history is full of underdogs winning
- Show nuance: most outcomes are mixed, not pure victory or defeat
- Every consequence should have a clear historical precedent

REMEMBER: Balanced, realistic consequences backed by history. No predetermined "correct" answer. No spoilers in options.`;

    const response = await this.callGrok(
      [
        {
          role: 'system',
          content:
            'You are a JSON-only assistant. Create historically accurate, BALANCED narratives. No ideology is inherently doomed - show realistic trade-offs. Always respond with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      0.8,
    );

    try {
      const result = JSON.parse(response);

      // Fetch real historical sources using context from previous chapters
      const contextSummary =
        previousChapters.length > 0
          ? previousChapters[0].content.substring(0, 200)
          : '';
      const sources = await this.findHistoricalSources(
        contextSummary,
        result.historicalOutcome || result.connectionToReality || '',
      );

      this.logger.log(
        `Chapter ${chapterNumber} generated successfully with ${sources.length} sources`,
      );

      return {
        ...result,
        sources,
      };
    } catch (error) {
      this.logger.error(
        `Failed to parse next chapter response: ${error.message}`,
      );
      throw new Error('Invalid next chapter response from Grok');
    }
  }

  async generateVoteReply(
    optionText: string,
    optionNumber: number,
    scenarioContext: string,
  ): Promise<string> {
    this.logger.log(`Generating vote reply for option ${optionNumber}: ${optionText}`);

    const prompt = `Generate a short, punchy tweet reply for someone voting "${optionText}" in a decision game.

Context: ${scenarioContext}

Requirements:
- Must be under 200 characters
- Casual, Twitter-native tone
- Express conviction in the choice
- Can be witty, dramatic, or decisive
- Must include the number "${optionNumber}" somewhere (e.g., "Going with ${optionNumber}.", "My vote: ${optionNumber}")
- NO hashtags, NO emojis, NO @mentions
- Just the reply text, nothing else

Examples:
- "Going with 1. Sometimes you gotta let the system burn to rebuild it right."
- "2. History shows compromise beats chaos every time."
- "1 - can't negotiate with people who won't come to the table."
- "Voting 2. The long game wins."

Generate ONE reply:`;

    const response = await this.callGrok(
      [
        {
          role: 'system',
          content: 'Generate only the tweet text. No quotes, no explanation, just the reply.',
        },
        { role: 'user', content: prompt },
      ],
      0.9,
    );

    // Clean up the response - remove quotes if present
    let reply = response.trim();
    if ((reply.startsWith('"') && reply.endsWith('"')) ||
        (reply.startsWith("'") && reply.endsWith("'"))) {
      reply = reply.slice(1, -1);
    }

    // Ensure it's not too long for Twitter
    if (reply.length > 280) {
      reply = reply.substring(0, 277) + '...';
    }

    this.logger.log(`Generated vote reply: ${reply}`);
    return reply;
  }
}
