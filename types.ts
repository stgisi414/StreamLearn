
export type EnglishLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export interface BrightDataArticle {
  link: string;
  title: string;
  snippet: string;
  source: string;
  timestamp: string;
}

// Response from BrightData can be one of these shapes
export interface BrightDataOrganicResult {
  organic: BrightDataArticle[];
}

export interface BrightDataNewsResult {
    news_results: BrightDataArticle[];
}

export type BrightDataResponse = BrightDataOrganicResult | BrightDataNewsResult;


export interface VocabularyItem {
  word: string;
  definition: string;
  example: string;
}

export interface GrammarPoint {
  title: string;
  explanation: string;
}

export interface Lesson {
  vocabulary: VocabularyItem[];
  comprehensionQuestions: string[];
  grammarPoint: GrammarPoint;
}
