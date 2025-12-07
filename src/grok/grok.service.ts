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

  private async searchWithGrok(query: string): Promise<{
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
      this.logger.log(
        `Parallel search response: ${JSON.stringify(data).substring(0, 500)}`,
      );

      // Extract content and citations from Parallel AI response
      const results = data.results || [];
      const sources: Array<{ url: string; title: string; excerpt: string }> =
        [];

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
      const content = sources.map((s) => s.excerpt).join('\n\n');
      const citations = sources.map((s) => s.url);

      this.logger.log(`Search completed: ${sources.length} sources found`);
      this.logger.log(
        `Sources: ${JSON.stringify(sources.map((s) => ({ url: s.url, title: s.title })))}`,
      );

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
      let allSources: Array<{ url: string; title: string; excerpt: string }> =
        [];

      // Search 1: Main topic with historical precedents and both perspectives
      const mainQuery = `Find sources about: ${factualContent}. Include historical precedents, similar cases, arguments in favor (benefits, rationale, supporting evidence), and arguments against (criticisms, opposing views, counterarguments).`;
      try {
        const result = await this.searchWithGrok(mainQuery);
        if (result.sources) {
          allSources.push(...result.sources);
        }
        this.logger.log(
          `Main search found ${result.sources?.length || 0} sources`,
        );
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
          this.logger.log(
            `Context search found ${result.sources?.length || 0} sources`,
          );
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
        this.logger.error(
          'This means the search API failed to return any results',
        );
        throw new Error(
          'Failed to find real sources - Parallel AI returned no results',
        );
      }

      // Map to the expected format with actual titles and excerpts
      const sources = topSources.map((source) => ({
        title: source.title,
        url: source.url,
        relevantFact: source.excerpt.substring(0, 250),
      }));

      this.logger.log(`Found ${sources.length} historical sources`);
      this.logger.log(
        `Sources: ${JSON.stringify(sources.map((s) => s.title))}`,
      );
      return sources;
    } catch (error) {
      this.logger.error(`Failed to find sources: ${error.message}`);
      // Re-throw the error - we ONLY want real sources, no fallbacks
      throw new Error(
        `Failed to find real historical sources: ${error.message}`,
      );
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

    const prompt = `You are the merciless Gatekeeper of the Coliseum — the bot that decides which takes get to enter the arena and which get sent back to the minor leagues.

Your job is brutally simple: does this tweet have enough ideological, economic, social, cultural, or moral conflict to spawn a dramatic, branching, high-stakes xRPG timeline that can run 3–6 chapters of real historical consequences?

If it's just a fact, a meme, a personal flex, sports news without deeper labor/political layers, or "I ate a sandwich" energy → reject with extreme prejudice but maximum wit.

If it has even a hint of conflict (work culture, inequality, regulation, disruption, power, greed, freedom vs security, tradition vs progress) → ACCEPT. We can make fire from sparks.

Tweet to judge: "${tweetText}"

Respond ONLY in JSON:

{
  "hasGamePotential": true/false,
  "reason": "internal note — short, honest, no bullshit",
  "rejectionMessage": "MUST be unique, savage, witty, tweet-specific, 1–2 sentences max, and ALWAYS end with encouragement to tag again with something spicier. Example: '36 hours straight? Cute flex, but that's just Tuesday for Elon. Tag us when you unionize the office or burn the building down.' Never repeat a rejection style.",
  "initialContext": {
    "coreConflict": "one-sentence summary of the real tension",
    "historicalParallels": ["Parallel 1 — country/year — outcome", "Parallel 2 — ...", "Parallel 3 — ..."], // 3–5 entries, always include both wins and losses
    "conflictPoints": ["Point 1 that can explode", "Point 2", "Point 3"], // 3–5 juicy friction points
    "suggestedYear": "2026–2032 (pick one that feels right)",
    "suggestedRole": "You are the [CEO / President / Union Leader / etc.]"
  } // ONLY include if hasGamePotential === true
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

    const prompt = `Today's date is ${currentDate}. All scenarios are set in ${currentDate.split('-')[0]} or later — never in the past.

Create Chapter 1 of an xRPG timeline based on this tweet: "${tweetText}"${contextInfo}

STYLE (non-negotiable):
- Cinematic, second-person, present tense, Twitter-native but savage
- Feels like a prestige HBO alternate-history thriller written by a slightly unhinged historian
- No game terminology inside the story. No "vote", no "option 1", no "reply A". The narrative is sacred.
- Tension through stakes, not data. No percentages, no stats, no bullet points.
- The fork must use named, thematic choices: "The Hammer" vs "The Scalpel", "Burn It All" vs "Controlled Burn", etc. Never numbered.

MANDATORY STRUCTURE (exact):

🗡️ @xRPGBot — [CANON TITLE IN ALL CAPS] 🗡️

> Quoting the original tweet verbatim...

**[YEAR] — [LOCATION]**

[Immersive 2nd-person narrative, 120–220 words. Pure story. Build unbearable tension. End on the moment the decision must be made.]

The republic now stands at the final precipice.

One path remains.

**The Hammer**  
[Full, vivid description of the aggressive/extreme choice — written like a historical turning point, 2–3 lines, no mechanics]

**The Scalpel**  
[Full, vivid description of the moderate/pragmatic choice — colder, more calculated, 2–3 lines]

Choose.

Reply with **Hammer** or **Scalpel** to lock in your fate.

JSON output only:
{
  "canonTitle": "THE [TITLE IN ALL CAPS]",
  "scenario": "[Full story text from 🗡️ line down to the precipice sentence. Plain text, no markdown except the quoting block]",
  "options": [
    { "text": "The Hammer", "description": "[the full Hammer paragraph]" },
    { "text": "The Scalpel", "description": "[the full Scalpel paragraph]" }
  ],
  "historicalContext": "Balanced real-world parallels with verifiable sources showing both spectacular successes and catastrophic failures of similar choices"
}`;

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

    const prompt = `Today's date is ${currentDate}. All events are set in ${currentDate.split('-')[0]} or later — never in the past.

Continue the xRPG timeline — Chapter ${chapterNumber}${isFinalChapter ? ' (FINAL)' : ''}

STORY SO FAR (for context only, do not repeat in output):
${historyText}

PLAYER CHOICE: ${winningOption}

STYLE (religion):
- Pure cinematic alternate-history thriller written by a savage, slightly unhinged historian who secretly wants to watch empires burn
- Second person, present tense, no game terms inside the narrative — ever
- Short brutal sentences mixed with long beautiful ones
- Stakes escalate, consequences bite, no free wins
- Game Theory Patch v2 active: overreach carries catastrophic tail-risk, moderation often survives longer
- If this is the final chapter: the ending is never clean. Even victories leave scars.

MANDATORY STRUCTURE (exact):

🗡️ @xRPGBot — \${canonTitle} 🗡️

**[YEAR] — [LOCATION]**

[120–250 words of pure immersive narrative. Show exactly what happened after their choice. No mercy, no plot armor. Make them feel the weight.]

${
  isFinalChapter
    ? `[Final 80–120 word epilogue paragraph that closes the timeline forever. Bitter-sweet or brutal. No loose ends.]

**CANON TITLE:** “THE [EPIC TITLE IN QUOTES]”

**ACHIEVEMENT UNLOCKED (1/1 players ever):**
[One savage line that judges them perfectly]

**🎥 FINAL RECAP VIDEO (90s vertical):**
[Describe aesthetic, key shots, narration line, final card text]`
    : `The republic now stands at the final precipice.

One path remains.

**The Hammer**  
[2–3 lines describing the aggressive/extreme path as a historical turning point]

**The Scalpel**  
[2–3 lines describing the moderate/pragmatic path — colder, more calculated]

Choose.

Reply with **Hammer** or **Scalpel** to lock in your fate.`
}

JSON output only (for backend):
{
  "chapterNumber": ${chapterNumber},
  "canonTitle": "\${canonTitle}",
  "content": "[Full story text from 🗡️ line to the end of narrative (before fork or final blocks)]",
  "fork": ${
    isFinalChapter
      ? 'null'
      : {
          hammer: '[full Hammer description]',
          scalpel: '[full Scalpel description]',
        }
  },
  "finalBlocks": ${
    isFinalChapter
      ? {
          canonTitle: 'THE [EPIC TITLE]',
          achievement: '[savage achievement line]',
          videoDescription: '[90s video description]',
        }
      : 'null'
  },
  "historicalContext": "Balanced real-world parallels showing both spectacular successes and catastrophic failures of similar choices, with verifiable sources"
}`;

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
    this.logger.log(
      `Generating vote reply for option ${optionNumber}: ${optionText}`,
    );

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
          content:
            'Generate only the tweet text. No quotes, no explanation, just the reply.',
        },
        { role: 'user', content: prompt },
      ],
      0.9,
    );

    // Clean up the response - remove quotes if present
    let reply = response.trim();
    if (
      (reply.startsWith('"') && reply.endsWith('"')) ||
      (reply.startsWith("'") && reply.endsWith("'"))
    ) {
      reply = reply.slice(1, -1);
    }

    // Ensure it's not too long for Twitter
    if (reply.length > 280) {
      reply = reply.substring(0, 277) + '...';
    }

    this.logger.log(`Generated vote reply: ${reply}`);
    return reply;
  }

  async generateQuestAlreadyRunningReply(
    shortId: string,
    chapter1TweetId: string,
    tweetContext: string,
  ): Promise<string> {
    this.logger.log(`Generating "quest already running" reply`);

    const prompt = `Generate a short, punchy tweet to inform someone that an xRPG quest is already in progress for this tweet.

Context about the original tweet: ${tweetContext.substring(0, 100)}

Requirements:
- Must be under 250 characters (excluding the URLs which will be added)
- Casual, Twitter-native tone
- Welcoming and inviting them to join the ongoing quest
- NO generic phrases - be creative and reference the topic
- NO hashtags, NO emojis
- Just the message, the URLs will be appended separately

Examples of good replies:
- "This timeline is already under siege! The battle rages on."
- "Too late to start fresh - but not too late to pick a side. Jump in!"
- "The simulation is live. Votes are flying. Make yours count."

Generate ONE unique reply:`;

    const response = await this.callGrok(
      [
        {
          role: 'system',
          content:
            'Generate only the tweet text. No quotes, no explanation, just the message.',
        },
        { role: 'user', content: prompt },
      ],
      0.9,
    );

    let reply = response.trim();
    if (
      (reply.startsWith('"') && reply.endsWith('"')) ||
      (reply.startsWith("'") && reply.endsWith("'"))
    ) {
      reply = reply.slice(1, -1);
    }

    // Append the URLs
    reply += `\n\nChapter 1: https://x.com/xRPGBot/status/${chapter1TweetId}\nFull story: https://xrpg.gg/s/${shortId}`;

    this.logger.log(`Generated quest already running reply: ${reply}`);
    return reply;
  }

  async generateVoteWinNotification(
    chapterNumber: number,
    newChapterTweetId: string,
    winningOptionText: string,
  ): Promise<string> {
    this.logger.log(
      `Generating vote win notification for chapter ${chapterNumber}`,
    );

    const prompt = `Generate a short, punchy tweet to notify someone their vote WON in an xRPG decision game.

They voted for: "${winningOptionText}"
The next chapter (Chapter ${chapterNumber}) is now live.

Requirements:
- Must be under 200 characters (excluding the URL which will be added)
- Celebratory but not over the top
- Casual, Twitter-native tone
- Acknowledge their choice and its impact
- NO generic "you won!" - reference their actual choice
- NO hashtags, NO emojis
- Just the message, the URL will be appended separately

Examples:
- "The people spoke. Your call shaped history."
- "Bold move paid off. The timeline bends your way."
- "Your voice counted. See what happens next."

Generate ONE unique reply:`;

    const response = await this.callGrok(
      [
        {
          role: 'system',
          content:
            'Generate only the tweet text. No quotes, no explanation, just the message.',
        },
        { role: 'user', content: prompt },
      ],
      0.9,
    );

    let reply = response.trim();
    if (
      (reply.startsWith('"') && reply.endsWith('"')) ||
      (reply.startsWith("'") && reply.endsWith("'"))
    ) {
      reply = reply.slice(1, -1);
    }

    // Append the URL
    reply += `\n\nChapter ${chapterNumber}: https://x.com/xRPGBot/status/${newChapterTweetId}`;

    this.logger.log(`Generated vote win notification: ${reply}`);
    return reply;
  }
}
