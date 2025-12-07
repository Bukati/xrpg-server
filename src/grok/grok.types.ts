export interface HistoricalSource {
  title: string;
  url: string;
  relevantFact: string;
}

export interface QuestOption {
  text: string;
  label: string;
}

export interface GameWorthinessResult {
  hasGamePotential: boolean;
  reason: string;
  rejectionMessage?: string;
  initialContext?: {
    topic: string;
    historicalParallels: string[];
    conflictPoints: string[];
  };
}

export interface QuestScenario {
  canonTitle: string;
  scenario: string;
  options: QuestOption[];
  sources: HistoricalSource[];
  historicalContext: string;
}

export interface VoteInterpretation {
  userId: string;
  replyText: string;
  selectedOption: number;
  interpretation: string;
  weight: number;
}

export interface VoteAnalysisResult {
  voteAnalysis: VoteInterpretation[];
  winningOption: number;
  participationStats: {
    totalReplies: number;
    uniqueVoters: number;
    optionBreakdown: {
      option1: number;
      option2: number;
      option3: number;
    };
  };
}

export interface NextChapter {
  chapterNumber: number;
  chapterTitle: string;
  content: string;
  options?: QuestOption[];
  sources: HistoricalSource[];
  historicalOutcome: string;
  connectionToReality: string;
}

export interface ChapterHistory {
  chapterNumber: number;
  content: string;
  selectedOption?: number;
  sources: HistoricalSource[];
}
