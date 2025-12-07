import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app'; // Added getApps, getApp
import {
  getAuth,
  onAuthStateChanged,
  User,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  connectAuthEmulator
} from 'firebase/auth';
import { 
  getFirestore, doc, setDoc, Timestamp,
  collection, query, orderBy, getDocs, limit,
  deleteDoc, where, addDoc, getDoc,
  connectFirestoreEmulator, onSnapshot, increment
} from 'firebase/firestore';
import { useTranslation, Trans } from 'react-i18next';
import { 
  getFunctions, 
  httpsCallable, 
  connectFunctionsEmulator 
} from 'firebase/functions';
import { HistoryIcon } from './components/icons/HistoryIcon';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ErrorMessage } from './components/ErrorMessage';
import { RestartIcon } from './components/icons/RestartIcon';
import { BookmarkIcon } from './components/icons/BookmarkIcon';
import { BookOpenIcon } from './components/icons/BookOpenIcon';
import { PencilSquareIcon } from './components/icons/PencilSquareIcon';
import { SearchIcon } from './components/icons/SearchIcon';
import { CreditCardIcon } from './components/icons/CreditCardIcon';
import { LanguageIcon } from './components/icons/LanguageIcon';
import { ArrowLeftIcon } from './components/icons/ArrowLeftIcon';
import { ChatBubbleIcon } from './components/icons/ChatBubbleIcon';
import { ChatAssistant } from './components/ChatAssistant';
import { VolumeUpIcon } from './components/icons/VolumeUpIcon';
import { ThumbsUpIcon } from './components/icons/ThumbsUpIcon';
import { ThumbsDownIcon } from './components/icons/ThumbsDownIcon';
import { PlayIcon } from './components/icons/PlayIcon';
import { PauseIcon } from './components/icons/PauseIcon';
import { CheckCircleIcon } from './components/icons/CheckCircleIcon';
import { LightBulbIcon } from './components/icons/LightBulbIcon';
import { BrainIcon } from './components/icons/BrainIcon';
import { BeakerIcon } from './components/icons/BeakerIcon';
import { PracticeCenter } from './components/PracticeCenter';
import { PracticeTopic, PracticeTopicType } from './types';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { Lesson, Article, NewsResult, EnglishLevel, LessonResponse, SavedWord, VocabularyItem, StripeSubscription, LanguageCode } from './types';
import { ArrowsRightLeftIcon } from './components/icons/ArrowsRightLeftIcon';
import { GuidedLessonFlow } from './components/GuidedLessonFlow';
import { ActivityContent } from './components/ActivityContent';
import { ActivityControls } from './components/ActivityControls';
import { InAppBrowserOverlay } from './components/InAppBrowserOverlay';

// --- NEW: Language Configuration ---
const languageCodes: LanguageCode[] = [
  'en', 'es', 'fr', 'de', 'it', 'ko', 'ja', 'zh', 'ar', 'ru', 'hi', 'pl', 'vi', 'pt', 'id', 'th'
];

type LanguageCode = typeof languageCodes[number];

// --- Configuration Variables ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_SfilteredLessonHistoryTORAGE_BUCKET, // Use the correct value from .env
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID // Optional
};

const FREE_LESSON_LIMIT = 25;
const STRIPE_PRICE_ID = import.meta.env.VITE_STRIPE_PRICE_ID;

// Initialize Firebase only if it hasn't been initialized yet
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Function to get the Function Base URL
function getFunctionBaseUrl(): string {
  const isDevelopment = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (isDevelopment) {
    return "/api";
  }
  const hostedFullUrl = (window as any).functionBaseUrl;
  if (typeof hostedFullUrl === 'string' && hostedFullUrl.length > 0) {
    const base = hostedFullUrl.split('/fetchNews')[0]; // Adjust if needed
    return base || hostedFullUrl;
  }
  // Fallback for production if variable isn't set (adjust if your production setup differs)
  // This assumes functions are served relative to the hosting origin under /api/
  return "/api";
}
const BASE_FUNCTION_URL = getFunctionBaseUrl();

/**
 * Custom hook to manage state in localStorage.
 * NOW reads from URL param on initial load.
 */
function useLanguageLocalStorageState(
    key: string, 
    defaultValue: LanguageCode, 
    urlParam: string | null = null
): [LanguageCode, React.Dispatch<React.SetStateAction<LanguageCode>>] {
  
  const [value, setValue] = useState<LanguageCode>(() => {
    if (urlParam) {
      try {
        const params = new URLSearchParams(window.location.search);
        const urlValue = params.get(urlParam) as any;
        // Ensure it's a valid lang code
        if (urlValue && languageCodes.includes(urlValue)) { 
          localStorage.setItem(key, JSON.stringify(urlValue)); // Save it
          return urlValue;
        }
      } catch (error) {
         console.warn(`Error reading URL param “${urlParam}”:`, error);
      }
    }

    // 2. Fallback to localStorage
    try {
      const storedValue = localStorage.getItem(key);
      // Check for null, 'undefined', or the literal string "null"
      if (storedValue === null) {
         return defaultValue;
      }
      // Parse the stored value
      const parsed = JSON.parse(storedValue);
      if (!parsed || !languageCodes.includes(parsed)) {
          console.warn(`Invalid language code "${parsed}" in localStorage for key "${key}". Reverting to default.`);
          return defaultValue;
      }
      // It's a valid, stored value
      return parsed;
    } catch (error) {
      console.warn(`Error reading localStorage key “${key}”:`, error, `. Reverting to default.`);
       return defaultValue;
    }
  });

  useEffect(() => {
    try {
      // The state `value` is typed as LanguageCode, so it should always be valid.
      // Just stringify and set it.
      localStorage.setItem(key, JSON.stringify(value));
     } catch (error) {
      console.warn(`Error setting localStorage key “${key}”:`, error);
    }
  }, [key, value]);

  return [value, setValue];
}

function useLocalStorageState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const storedValue = localStorage.getItem(key);
      // Check for null, 'undefined', or the literal string "null"
      if (storedValue === null || storedValue === 'undefined' || storedValue === 'null') {
        return defaultValue;
      }
      const parsed = JSON.parse(storedValue);
      // Final check: if parsing results in null but default isn't null, use default
      return parsed ?? defaultValue;
    } catch (error) {
      console.warn(`Error reading localStorage key “${key}”:`, error);
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      // Don't save if value is undefined
      if (value === undefined) {
         localStorage.removeItem(key);
      } else {
         localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      console.warn(`Error setting localStorage key “${key}”:`, error);
    }
  }, [key, value]);

  return [value, setValue];
}

// --- Main App Component ---
type AppView = 'LOADING' | 'LANDING' | 'DASHBOARD' | 'INPUT' | 'NEWS_LIST' | 'LESSON_VIEW' | 'ACTIVITY' | 'WORD_BANK'
              | 'PRICING' | 'TERMS' | 'PRIVACY';

// Interface for lessons fetched from Firestore
interface SavedLesson {
  id: string;
  userId: string;
  topic: string;
  level: EnglishLevel;
  articleUrl: string;
  lessonData: Lesson;
  source: string;
  date: string;
  image?: string;
  createdAt: Timestamp;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

// Type for activity state
type ActivityType = 'vocab' | 'grammar' | 'comprehension' | 'writing' | 'wordbank_study' | 'wordbank_review' | 'grammar_standalone' | 'writing_standalone';
interface ActivityState {
  type: ActivityType;
  index: number; // Current question/word index
  score: number;
  total: number;
  shuffledIndices?: number[];
  // Data for the current step (e.g., definition, word, OPTIONS, grammar question/options, comprehension question)
  currentData: {
    word?: string; // Correct word (always present for vocab)
    definition?: string; // Definition (for vocab)
    options?: string[]; // Multiple choice options (for vocab Beginner/Intermediate)
    question?: string; // For grammar/comprehension
    summary?: string; // For comprehension
    correctAnswer?: string; // Correct letter for grammar MC
    finished?: boolean; // Flag for completion state
    // Allow other properties for grammar
    [key: string]: any;
  } | null; // Make currentData potentially null initially
  userAnswer: string | number | null; // User's input/selection (Use string for vocab answers now)
  feedback: { isCorrect: boolean | null; message: string };
  isSubmitting: boolean; // Flag for API call loading
  _loadingStepKey?: string | null;
}

const App: React.FC = () => {
  // DEBUG: Add render count
  const appRenderCount = useRef(0);
  appRenderCount.current += 1;
  // END DEBUG

  console.log("DEBUG: --- App Component Re-render ---");
  const { t, i18n } = useTranslation();

  // --- Auth State ---
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<'LOADING' | 'SIGNED_OUT' | 'SIGNED_IN'>('LOADING');

  const [isPracticeCenterOpen, setIsPracticeCenterOpen] = useState(false);

  // --- View State (derived from URL and authState) ---
  const [currentView, setCurrentView] = useState<AppView>('LOADING');

  // --- NEW: Lesson History State ---
  const [lessonHistory, setLessonHistory] = useState<SavedLesson[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // --- NEW: Word Bank State ---
  const [wordBank, setWordBank] = useState<SavedWord[]>([]);
  const [isWordBankLoading, setIsWordBankLoading] = useState(false);
  const [wordBankMessage, setWordBankMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

  // --- NEW: Dashboard Filter State ---
  const [dashboardSearchTerm, setDashboardSearchTerm] = useState('');

  // --- NEW: Language State ---
  // Default to English UI, learning English
  // ADD urlParam 'lang' to uiLanguage
  const [uiLanguage, setUiLanguage] = useLanguageLocalStorageState('streamlearn_uiLang', 'en', 'lang');
  const [targetLanguage, setTargetLanguage] = useLanguageLocalStorageState('streamlearn_targetLang', 'en');

  // --- NEW: Subscription State ---
  const [subscription, setSubscription] = useState<StripeSubscription | null>(null);
  const [isSubLoading, setIsSubLoading] = useState(true); // Start true on load
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const isSubscribed = subscription?.status === 'active' || subscription?.status === 'trialing';

  const [liveChatUsageCount, setLiveChatUsageCount] = useState<number | null>(null);
  const [isUsageLoading, setIsUsageLoading] = useState(true); // Tracks loading for the usage doc

  // --- Global Error ---
  const [error, setError] = useState<string | null>(null);

  // --- Loading State (for API calls) ---
  const [isApiLoading, setIsApiLoading] = useState(false);
  const [isLessonGenerating, setIsLessonGenerating] = useState(false);

  // --- NEW: State to prevent save/load race condition ---
  const [isUserConfigLoading, setIsUserConfigLoading] = useState(true);

  // --- NEW: Lesson View State ---
  const [lessonViewMode, setLessonViewMode] = useLocalStorageState<'overview' | 'guided'>('streamlearn_lessonViewMode', 'overview');
  // --- NEW: Persisted step state ---
  const [guidedLessonStep, setGuidedLessonStep] = useLocalStorageState<number>('streamlearn_guidedStep', 0);
  const [guidedLessonId, setGuidedLessonId] = useLocalStorageState<string | null>('streamlearn_guidedLessonId', null);

  // --- Activity state ---
  const [activityState, setActivityState] = useState<ActivityState | null>(null);
  const loadingStepRef = useRef<string | null>(null);
  const activityCancellationRef = useRef(false);
  const lastActivityTypeRef = useRef<ActivityType | null>(null);

  // --- NEW: Audio State ---
  const [isActivityAudioLoading, setIsActivityAudioLoading] = useState(false); // Renamed from isAudioLoading
  const [activityAudioError, setActivityAudioError] = useState<string | null>(null); // Renamed from audioError
  const activityAudioRef = useRef<HTMLAudioElement | null>(null); // Renamed from currentAudioRef

  // --- NEW: Summary Audio Player State ---
  const summaryAudioRef = useRef<HTMLAudioElement | null>(null); // Ref for the audio element
  const [summaryAudioSrc, setSummaryAudioSrc] = useState<string | null>(null); // Store the audio data URL
  const [isSummaryPlaying, setIsSummaryPlaying] = useState<boolean>(false);
  const [summaryAudioProgress, setSummaryAudioProgress] = useState<number>(0);
  const [summaryAudioDuration, setSummaryAudioDuration] = useState<number>(0);
  const [isSummaryAudioLoading, setIsSummaryAudioLoading] = useState<boolean>(false);
  const [summaryAudioError, setSummaryAudioError] = useState<string | null>(null);

  // --- Persistent State ---
  const [inputTopic, setInputTopic] = useLocalStorageState<string>('streamlearn_topic', '');
  // --- NEW: Per-language level state ---
  // Default levels for all languages
  const defaultLevels: Record<LanguageCode, EnglishLevel> = {
    'en': 'Intermediate', 'es': 'Beginner', 'fr': 'Beginner', 'de': 'Beginner',
    'it': 'Beginner', 'ko': 'Beginner', 'ja': 'Beginner', 'zh': 'Beginner', 
    'ar': 'Beginner', 'ru': 'Beginner', 'hi': 'Beginner', 'pl': 'Beginner',
    'vi': 'Beginner', 'pt': 'Beginner', 'id': 'Beginner', 'th': 'Beginner'
  };

  const [languageLevels, setLanguageLevels] = useLocalStorageState<Record<LanguageCode, EnglishLevel>>('streamlearn_languageLevels', defaultLevels);
 
  // Derived state: Get the level for the *current* target language
  const inputLevel = languageLevels[targetLanguage] || 'Intermediate';
 
  // Setter: Update the level for the *current* target language
  const setInputLevel = (newLevel: EnglishLevel) => {
    setLanguageLevels(prev => ({
      ...prev,
      [targetLanguage]: newLevel
    }));
  };
  // This is the *full* list of articles from the last search
  const [allFetchedArticles, setAllFetchedArticles] = useLocalStorageState<NewsResult[]>('streamlearn_allResults', []);
  // This is the *visible* list of articles (e.g., the top 10)
  const [visibleNewsResults, setVisibleNewsResults] = useLocalStorageState<NewsResult[]>('streamlearn_visibleResults', []);
  const [currentArticle, setCurrentArticle] = useLocalStorageState<Article | null>('streamlearn_article', null);
  const [currentLesson, setCurrentLesson] = useLocalStorageState<Lesson | null>('streamlearn_lesson', null);
  const [articleFeedbackMessage, setArticleFeedbackMessage] = useState<string | null>(null);
  const initialUrlHandled = useRef(false);

  const [replacementIndex, setReplacementIndex] = useLocalStorageState<number>('streamlearn_replacementIndex', 10);

  const [generatedGrammarExamples, setGeneratedGrammarExamples] = useState<string[]>([]);
  const [isGeneratingExample, setIsGeneratingExample] = useState(false);

  const [translatedArticles, setTranslatedArticles] = useLocalStorageState<Record<string, { translatedTitle: string, translatedSnippet: string }>>("streamlearn_translatedArticles", {}); // <-- MODIFY THIS (useLocalStorageState, new key)
  const [isTranslating, setIsTranslating] = useState<string | null>(null); // <-- MODIFY THIS (string | null)
  const [toggledTranslations, setToggledTranslations] = useState<Record<string, boolean>>({});

  const [chatHistory, setChatHistory] = useLocalStorageState<ChatMessage[]>('streamlearn_chatHistory', []);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const CHAT_HISTORY_LIMIT = 50;

  // --- NEW: State for comprehension answers ---
  const [comprehensionAnswers, setComprehensionAnswers] = useState<Record<number, string>>({});
  const [isAnswerLoading, setIsAnswerLoading] = useState<number | null>(null); // Stores the index of the loading question

  const [isLikingArticle, setIsLikingArticle] = useState<string | null>(null);
  const [isDislikingArticle, setIsDislikingArticle] = useState<string | null>(null);

  // --- NEW: State for Word Bank language filter ---
  const [wordBankLanguageFilter, setWordBankLanguageFilter] = useState<LanguageCode | 'all'>('all');

  // --- NEW: Question History State ---
  // Structure: { [languageCode]: { [topicTitle]: string[] } }
  const [questionHistory, setQuestionHistory] = useLocalStorageState<Record<string, Record<string, string[]>>>('streamlearn_questionHistory', {});

  // --- Static Data ---
  const newsTopics: string[] = [
    "Technology", "Business", "World News", "US Politics", "Health", "Science",
    "Environment", "Sports", "Entertainment", "Finance", "AI", "Space",
    "Climate Change", "Cybersecurity", "Electric Vehicles", "Global Economy"
  ];

  // DEBUG: Log component state
  console.log(`DEBUG_APP: Render #${appRenderCount.current} | View: ${currentView} | AuthState: ${authState} | SubLoading: ${isSubLoading} | SummaryAudioProgress: ${summaryAudioProgress}`);

  // --- Firebase Service Memos ---
  const db = useMemo(() => getFirestore(app), []);
  const auth = useMemo(() => getAuth(app), []);
  const functions = useMemo(() => getFunctions(app), []);

  useEffect(() => {
    if (i18n.language !== uiLanguage) {
      i18n.changeLanguage(uiLanguage);
    }
  }, [uiLanguage, i18n]);

  // --- Emulator Connection ---
  useEffect(() => {
    const isDevelopment = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isDevelopment) {
      try {
        // Only connect if not already connected (Firebase throws error otherwise)
        if (!(auth as any).emulatorConfig) {
           connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
           console.log("Auth emulator connected.");
        }
        // --- ADD THIS BLOCK ---
        try {
          // connectFirestoreEmulator(db, 'localhost', 8080);
          // console.log("Firestore emulator connected.");
          console.log("Firestore emulator connection SKIPPED to test cloud extensions."); 

          // Connect to the functions emulator
          connectFunctionsEmulator(functions, 'localhost', 5001); // <-- ADD THIS
          console.log("Functions emulator connected."); // <-- ADD THIS

        } catch (e) {
          console.warn("Could not connect firestore emulator (might already be connected).", e)
        }
        // --- END ADD ---
      } catch (e) {
        console.warn("Could not connect auth emulator (might already be connected or emulator not running).", e);
      }
    }
  }, [auth, db]);

  // --- Forward declaration for handleUrlChange ---
  // We need this because navigate uses it, and it uses navigate (via goToInput etc.)
  const handleUrlChangeRef = React.useRef<
    (path: string, params: URLSearchParams, newState?: { article?: Article | null }) => void
  >(() => {});

  // --- Navigation Functions ---
  const navigate = useCallback((path: string, search: string = '', newState?: { article?: Article | null }) => {
    console.log("Navigating to:", path, search);
    const newUrl = `${window.location.origin}${path}${search}`;
    if (window.location.href !== newUrl) {
      window.history.pushState({ path, search, ...newState }, '', newUrl);
      console.log("URL updated via pushState.");
    } else {
      console.log("URL is already correct, triggering handler manually.");
    }
    // Use the ref to call the latest version of handleUrlChange
    handleUrlChangeRef.current(path, new URLSearchParams(search), newState);
  }, []); // navigate itself has no dependencies now

  const goToInput = useCallback(() => {
    navigate('/new');
  }, [navigate]);

  const goToSearch = useCallback((query: string, level: EnglishLevel) => {
    navigate('/search', `?q=${encodeURIComponent(query)}&level=${level}`);
  }, [navigate]);

  const goToLesson = useCallback((article: Article) => {
    setCurrentArticle(article); // Set localStorage immediately
    navigate('/lesson', `?url=${encodeURIComponent(article.link)}`, { article });
  }, [navigate, setCurrentArticle]);



  // --- Core Fetch Helper ---
  const authenticatedFetch = useCallback(async (functionName: string, data: object) => {
    const user = auth.currentUser;
    if (!user) {
      console.error("No user signed in to make authenticated call.");
      throw new Error("User not authenticated.");
    }
    
    // Get the ID token
    const token = await user.getIdToken();
    
    const url = `${BASE_FUNCTION_URL}/${functionName}`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` // This is what the backend expects
        },
        // The backend functions expect the data to be in a 'data' property
        body: JSON.stringify({ data: data }) 
      });

      if (!response.ok) {
        // Try to parse error from Firebase Functions
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          // Not a JSON error
          throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        
        // Throw the error message from the function, which is in errorData.error
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      // My functions return { data: ... }, so I'll parse the JSON
      // and return the 'data' property from the response body.
      const responseData = await response.json();
      return responseData.data; // Return the nested data object

    } catch (e) {
      console.error(`Error calling function ${functionName}:`, e);
      throw e; // Re-throw the error
    }
  }, [auth]); // <-- FIX: remove 'functions', keep 'auth'

  const monthlyLessonCount = useMemo(() => {
    if (!lessonHistory) return 0;
    const currentMonthISO = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    return lessonHistory.filter(lesson => {
      // Make sure createdAt is a Timestamp before calling .toDate()
      if (lesson.createdAt && typeof lesson.createdAt.toDate === 'function') {
        const lessonDate = lesson.createdAt.toDate();
        const lessonMonthISO = lessonDate.toISOString().slice(0, 7);
        return lessonMonthISO === currentMonthISO;
      }
      return false;
    }).length;
  }, [lessonHistory]);

  // --- API Call Handlers ---
  const handleFindArticles = useCallback(async (topicOverride?: string, skipNavigation: boolean = false) => {
    const topicToUse = topicOverride !== undefined ? topicOverride : inputTopic;
    if (!topicToUse || topicToUse.trim() === '') {
      setError("Please enter a topic of interest.");
      console.error("Search attempted with empty or invalid topic.");
      return;
    }
    const topicToSearch = topicToUse.trim();

    if (authState !== 'SIGNED_IN' || !user) {
        setError("Please sign in first.");
        return;
    }

    if (!isSubscribed && monthlyLessonCount >= FREE_LESSON_LIMIT) {
      setError(`You have used all ${FREE_LESSON_LIMIT} of your free lessons for this month. Please upgrade to create more.`);
      return; // Stop the search
    }

    setTranslatedArticles({});
    setIsTranslating(null);
    setToggledTranslations({});

    setReplacementIndex(10);

    setIsApiLoading(true);
    setError(null);
    if (!skipNavigation) {
        setAllFetchedArticles([]);
        setVisibleNewsResults([]);
    }

    // Navigate or set view
    if (!skipNavigation) {
      goToSearch(topicToSearch, inputLevel); // This calls navigate, which calls handleUrlChange
    } else {
      setCurrentView('NEWS_LIST'); // Directly set view if navigation is skipped (e.g., on refresh)
    }

    try {
      const results = await authenticatedFetch('fetchNews', {
        query: topicToSearch,
        languageCode: targetLanguage
      }) as NewsResult[];
      if (!results || results.length === 0) {
        setError(`No current news articles found for "${topicToSearch}".`);
        setAllFetchedArticles([]);
        setVisibleNewsResults([]);
      } else {
        const validResults = results.filter(r => r.title && r.link);
        setAllFetchedArticles(validResults); // Save all results
        setVisibleNewsResults(validResults.slice(0, 10)); // Show first 10
      }
    } catch (e) {
       // Error is already set by authenticatedFetch, view might reset via handleUrlChange if needed
       // Go back to input as a safety measure if API fails badly
       if (!skipNavigation) goToInput();
    } finally {
      setIsApiLoading(false);
    }
  }, [
      authState, user, authenticatedFetch, inputTopic, inputLevel, setAllFetchedArticles, setVisibleNewsResults, 
      setError, goToSearch, goToInput, setCurrentView, 
      isSubscribed, monthlyLessonCount, t,
      targetLanguage
  ]);

  // --- NEW: Helper to fetch summary audio ---
  // --- NEW: Helper to fetch summary audio ---
  const fetchSummaryAudio = useCallback(async (summaryText: string, langCode: LanguageCode) => {
    // --- DEBUG LOG ---
    console.log(`[AUDIO_DEBUG] 1. fetchSummaryAudio: CALLED. isSummaryAudioLoading: ${isSummaryAudioLoading}, summaryAudioSrc exists: ${!!summaryAudioSrc}`);
    // ---

    if (!summaryText || isSummaryAudioLoading || summaryAudioSrc) {
      // --- DEBUG LOG ---
      console.log(`[AUDIO_DEBUG] 1a. fetchSummaryAudio: Bailing early.`);
      // ---
      return; // Don't fetch if loading, already have src, or no text
    }

    // --- START FIX: Add length check and truncation ---
    if (summaryText.length > 1500) {
      console.warn(`Summary is too long for TTS (${summaryText.length} > 1500 chars). Truncating.`);
      summaryText = summaryText.substring(0, 1500); // Truncate the text
    }
    // --- END FIX ---

    console.log("[AUDIO_DEBUG] 1b. fetchSummaryAudio: Fetching from backend...");
    setIsSummaryAudioLoading(true);
    setSummaryAudioError(null);
    setError(null); // Clear main error too

    try {
      const response = await authenticatedFetch('textToSpeech', { 
        text: summaryText,
        langCode: langCode
      });
      if (response.audioContent) {
        const audioData = `data:audio/mp3;base64,${response.audioContent}`;
        
        // --- DEBUG LOG ---
        console.log(`[AUDIO_DEBUG] 2. fetchSummaryAudio: SUCCESS. Calling setSummaryAudioSrc with data (length: ${audioData.length}). This should trigger the useEffect.`);
        // ---
        
        setSummaryAudioSrc(audioData); // Set the source, useEffect will create Audio object
        
        // --- DEBUG LOG ---
        console.log(`[AUDIO_DEBUG] 3. fetchSummaryAudio: setSummaryAudioSrc has been called.`);
        // ---
      } else {
        throw new Error("Backend did not return audio content for summary.");
      }
    } catch (e) {
      console.error("Summary TTS Fetch Error:", e);
      setSummaryAudioError(`Failed to get summary audio: ${(e as Error).message}`);
    } finally {
      setIsSummaryAudioLoading(false);
    }
  }, [authenticatedFetch]); // <-- REMOVED isSummaryAudioLoading and summaryAudioSrc

  const handleSelectArticle = useCallback(async (article: Article, skipNavigation: boolean = false) => {
    console.log("handleSelectArticle called for:", article.link);
    if (authState !== 'SIGNED_IN' || !user) {
        setError("Please sign in first.");
        return;
    }

    // Client-side check for immediate UX feedback
    const isFreeTierLimitReached = !isSubscribed && monthlyLessonCount >= FREE_LESSON_LIMIT;
    if (isFreeTierLimitReached) {
      setError(`You have used all ${FREE_LESSON_LIMIT} of your free lessons for this month. Please upgrade to create more.`);
      setIsApiLoading(false);
      setIsLessonGenerating(false);
      // If they're on the lesson page, send them back to input.
      goToInput();
      return;
    }

    if (!skipNavigation && currentArticle?.link === article.link && currentLesson) {
        console.log("Clicked same article, lesson exists. Navigating without refetch.");
        goToLesson(article);
        return;
    }

    // --- NEW: Check and reset guided lesson step ---
    const newLessonId = article.link;
    if (newLessonId !== guidedLessonId) {
      console.log("New lesson selected, resetting guided step to 0.");
      setGuidedLessonStep(0); // This will save "0" to localStorage
      setGuidedLessonId(newLessonId); // Save the new lesson ID
    }

    console.log("Proceeding to fetch/generate lesson.");
    setIsApiLoading(true);
    setIsLessonGenerating(true);
    setError(null);

    if (currentArticle?.link !== article.link) {
        console.log("Clearing previous lesson/audio state for new article selection.");
        setCurrentLesson(null);
        setSummaryAudioSrc(null);
        setIsSummaryPlaying(false);
        setSummaryAudioProgress(0);
        setSummaryAudioDuration(0);
        setSummaryAudioError(null);
        if (summaryAudioRef.current) {
            summaryAudioRef.current.pause();
            summaryAudioRef.current.src = ''; // Eagerly release resources
            summaryAudioRef.current = null;
        }
        setChatHistory([]);
        setChatError(null);
        setGeneratedGrammarExamples([]);
    }

    setCurrentArticle(article);

    if (!skipNavigation) {
      goToLesson(article);
    } else {
      setCurrentView('LESSON_VIEW');
    }

    // --- FIX: Declare responseData outside the if block ---
    let responseData: any = null;
    // --- END FIX ---

    try {
        let lessonToSave = (currentArticle?.link === article.link) ? currentLesson : null;

        if (!lessonToSave) {
            console.log("No current lesson found or different article, calling createLesson API...");
            responseData = await authenticatedFetch('createLesson', {
                articleUrl: article.link,
                title: article.title,
                snippet: article.snippet || '',
                level: inputLevel,
                uiLanguage: uiLanguage,
                targetLanguage: targetLanguage
            });

            if (responseData?.success && responseData?.lesson) { // Added null checks
                lessonToSave = responseData.lesson as Lesson;
                console.log("Lesson generated successfully, calling setCurrentLesson.");
                setCurrentLesson(lessonToSave);
                if (lessonToSave.summary) {
                    // --- FIX 2: Pass targetLanguage ---
                    fetchSummaryAudio(lessonToSave.summary, targetLanguage);
                }
            } else {
                setError(responseData?.error || responseData?.details || "Lesson generation failed."); // Added null checks
                setIsLessonGenerating(false);
                setIsApiLoading(false);
                if (!skipNavigation) goToInput();
                return;
            }
        } else {
           console.log("Lesson already exists in state, potentially fetching audio.");
           if (lessonToSave.summary && !summaryAudioSrc && !isSummaryAudioLoading) {
               // --- FIX 3: Pass targetLanguage ---
               fetchSummaryAudio(lessonToSave.summary, targetLanguage);
           }
        }

      if (lessonToSave) {
          const lessonDocId = btoa(article.link)
            .replace(/\//g, '_') // Replace '/' with '_'
            .replace(/\+/g, '-'); // Replace '+' with '-'
          await setDoc(doc(db, `users/${user.uid}/lessons`, lessonDocId), {
              userId: user.uid,
              topic: inputTopic,
              level: inputLevel,
              articleUrl: article.link,
              source: article.source,
              date: article.date,
              image: article.image || null,
              lessonData: lessonToSave,
              summarySource: responseData?.summarySource || (currentLesson as any)?.summarySource || 'unknown',
              createdAt: Timestamp.now()
          });
          console.log("Lesson saved/resaved to Firestore");
      }

    } catch (e) {
      console.error("Error in handleSelectArticle API call block:", e);
      // Check if the error is the ReferenceError or something else
      if (e instanceof ReferenceError) {
          setError(`Programming error: Trying to use a variable before it's defined. (${(e as Error).message})`);
      } else {
          setError(`Failed to process lesson: ${(e as Error).message}`);
      }
      // --- FIX: Avoid navigating home on error if skipNavigation is true ---
      if (!skipNavigation) {
          goToInput(); // Go back only if user initiated this action
      }
      // --- END FIX ---
    } finally {
        console.log("handleSelectArticle finally block.");
        setIsLessonGenerating(false);
        setIsApiLoading(false);
    }
  }, [
      // --- REMOVE skipNavigation from this list ---
      authState, user, currentArticle?.link, currentLesson, inputLevel, inputTopic,
      db, // <-- skipNavigation was here, now removed
      setError, setIsApiLoading, setIsLessonGenerating, setCurrentLesson,
      setSummaryAudioSrc, setIsSummaryPlaying, setSummaryAudioProgress,
      setSummaryAudioDuration, setSummaryAudioError, setCurrentArticle,
      goToLesson, goToInput, authenticatedFetch, fetchSummaryAudio,
      t, uiLanguage, targetLanguage
      // --- END REMOVAL ---
  ]);

  const handleSaveWord = useCallback(async (vocabItem: VocabularyItem) => {
    if (!user) return;

    // Use the word itself as the document ID to prevent duplicates
    const docId = vocabItem.word;
    
    // Check local state first for instant feedback
    if (wordBank.some(w => w.word === docId)) {
      setWordBankMessage({ text: "Already saved!", type: 'error' });
      setTimeout(() => setWordBankMessage(null), 2000);
      return;
    }

    const newSavedWord: SavedWord = {
      ...vocabItem,
      id: docId,
      userId: user.uid,
      createdAt: Timestamp.now(),
     targetLanguage: targetLanguage, 
    };

    try {
      await setDoc(doc(db, `users/${user.uid}/wordBank`, newSavedWord.id), newSavedWord);
      
      // Add to local state (at the top of the list)
      setWordBankMessage({ text: "Word Saved!", type: 'success' });

    } catch (err) {
      console.error("Error saving word:", err);
      setWordBankMessage({ text: `Error: ${(err as Error).message}`, type: 'error' });
    } finally {
      setTimeout(() => setWordBankMessage(null), 2000);
    }
  }, [user, wordBank, targetLanguage, db, setWordBankMessage]);

  const handleDeleteWord = useCallback(async (word: string) => {
    if (!user) return;

    if (activityAudioRef.current) {
        activityAudioRef.current.pause();
        activityAudioRef.current = null;
    }

    try {
      await deleteDoc(doc(db, `users/${user.uid}/wordBank`, word));
      
      // Remove from local state
      setWordBank(prev => prev.filter(w => w.word !== word));
      setWordBankMessage({ text: "Word Deleted.", type: 'success' });
      
    } catch (err) {
      console.error("Error deleting word:", err);
      setWordBankMessage({ text: `Error: ${(err as Error).message}`, type: 'error' });
    } finally {
      setTimeout(() => setWordBankMessage(null), 2000);
    }
  }, [user, db, setWordBankMessage]);

  const handleSelectPastLesson = useCallback((lesson: SavedLesson) => {
    console.log("Loading past lesson:", lesson.lessonData.articleTitle);
    // Re-construct the 'Article' object needed for the lesson view
    const article: Article = {
      title: lesson.lessonData.articleTitle,
      link: lesson.articleUrl,
      source: lesson.source,
      date: lesson.date,
      snippet: '', // Snippet isn't critical for re-opening a lesson
      image: lesson.image // Keep image if it's somehow already in state, otherwise undefined
    };

    // Set topic/level state regardless
    setInputTopic(lesson.topic);
    setInputLevel(lesson.level);
    setCurrentArticle(article);

    // FIX: Check lesson.summarySource, NOT lesson.lessonData.summarySource
    if ((lesson as any).summarySource === "saved_stub") { 
      console.log("This is a saved stub. Clearing currentLesson to trigger generation on nav.");
      setCurrentLesson(null); // <-- THIS IS THE KEY.
    } else if (lesson.lessonData) { // Check that lessonData exists
       console.log("This is a full lesson. Loading from history...");
       setCurrentLesson(lesson.lessonData); // Load the full lesson data
     }

     // --- NEW: Check and set guided lesson step ---
    const newLessonId = lesson.articleUrl;
    if (newLessonId !== guidedLessonId) {
      console.log("New past lesson selected, resetting guided step to 0.");
      setGuidedLessonStep(0); // Reset for the new lesson
      setGuidedLessonId(newLessonId);
    }

    // Navigate *after* setting state. handleUrlChange will do the rest.
    navigate('/lesson', `?url=${encodeURIComponent(lesson.articleUrl)}`, { article });
 
  }, [navigate, setCurrentArticle, setCurrentLesson, setInputTopic, setInputLevel, handleSelectArticle]);

  // --- NEW: Subscription Functions ---
  const fetchSubscriptionStatus = useCallback(async (user: User) => {
    if (!user) return;
    console.log("DEBUG: fetchSubscriptionStatus - STARTING..."); // <-- ADD THIS
    setIsSubLoading(true);
    try {
      // Note: This query is simple. The Stripe extension *overwrites* docs,
      // so we just look for the first active/trialing one.
      const subRef = collection(db, `customers/${user.uid}/subscriptions`); // <--- FIX HERE
      const q = query(subRef, where("status", "in", ["active", "trialing"]), limit(1));
      
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        setSubscription(null);
        setIsSubLoading(false); // This was the bug from before, make sure it's false
        console.log("DEBUG: fetchSubscriptionStatus - No active sub found."); // <-- ADD THIS
      } else {
        const sub = querySnapshot.docs[0].data() as StripeSubscription;
        setSubscription(sub);
        console.log("Active subscription found. Status:", sub.status);
      }
    } catch (err) {
      console.error("Error fetching subscription:", err);
      // Don't block app, just assume user is free
      setSubscription(null);
    } finally {
      console.log("DEBUG: fetchSubscriptionStatus - FINISHED (finally block)."); // <-- ADD THIS
      setIsSubLoading(false);
    }
  }, [db]); // Add db dependency

  const handleManageBilling = async () => {
    if (!user) return;
    setIsBillingLoading(true);
    setError(null);

    try {
      // Get a reference to the extension's callable function
      const createPortalLink = httpsCallable(
        functions, 
        'ext-firestore-stripe-payments-createPortalLink' // This is the exact name of the extension function
      );

      // Call the function with the returnUrl
      const response: any = await createPortalLink({
        returnUrl: window.location.origin + '/' // Return to dashboard
      });

      // Redirect user to the Stripe portal
      if (response.data && response.data.url) {
        window.location.href = response.data.url;
      } else {
        throw new Error("No portal URL returned from server.");
      }
    } catch (err) {
      console.error("Error creating portal link:", err);
      let message = (err as Error).message;
      // Provide a more helpful error for the common case
      if (message.includes('NOT_FOUND') || message.includes('does not exist')) {
        message = "Could not find the billing function. (Is the Stripe extension correctly configured for Customer Portal?)";
      }
      setError(`Could not open billing portal: ${message}`);
      setIsBillingLoading(false);
    }
    // No finally needed, as user is redirected on success
  };

  const handleCheckout = async () => {
    if (!user) {
      setError("You must be signed in to upgrade.");
      return;
    }

    if (!STRIPE_PRICE_ID.includes("price_")) {
       console.error("Stripe Price ID is not configured. Using placeholder alert.");
       alert("Stripe Checkout is not yet configured by the developer.");
       return;
    }

    console.log("Creating checkout session...");
    setIsBillingLoading(true); // Reuse billing loading state
    setError(null);

    try {
      // Create a new checkout session document
      const checkoutSessionRef = await addDoc(
        collection(db, `customers/${user.uid}/checkout_sessions`),
        {
          price: STRIPE_PRICE_ID, // Your Price ID
          success_url: window.location.origin, // Return to dashboard on success
          cancel_url: window.location.href,    // Return to pricing page on cancel
          mode: 'subscription',
        }
      );

      // Listen for the URL generated by the Stripe extension
      onSnapshot(checkoutSessionRef, (snap) => {
        const { error, url } = snap.data() || {};
        if (error) {
          setError(`Stripe error: ${error.message}`);
          setIsBillingLoading(false);
        }
        if (url) {
          // Redirect to Stripe checkout
          window.location.href = url;
        }
      });
    } catch (err) {
      console.error("Error creating checkout session:", err);
      setError(`Could not create checkout session: ${(err as Error).message}`);
      setIsBillingLoading(false);
    }
    // No finally, as user is redirected on success
  };

  // --- NEW: Function to start the checkout process ---
  const handleStartSubscription = async () => {
    if (!user) {
      setError("You must be signed in to subscribe.");
      return;
    }
    if (!STRIPE_PRICE_ID) {
      setError("Pricing is not configured correctly. Please contact support.");
      console.error("VITE_STRIPE_PRICE_ID is not set in .env");
      return;
    }

    setIsBillingLoading(true); // Reuse billing loading state
    setError(null);

    try {
      // Create a new checkout session document in Firestore
      // The Stripe extension listens for this
      const checkoutSessionRef = collection(db, `users/${user.uid}/checkout_sessions`);
      const docRef = await addDoc(checkoutSessionRef, {
        price: STRIPE_PRICE_ID,
        success_url: window.location.origin, // Return to dashboard on success
        cancel_url: window.location.href,    // Return to this pricing page on cancel
      });

      // Listen to the new document for the redirect URL
      const unsubscribe = onSnapshot(docRef, (snap) => {
        const data = snap.data();
        if (data) {
          const { error, url } = data;
          if (error) {
            setError(`Stripe Error: ${error.message}`);
            setIsBillingLoading(false);
            unsubscribe(); // Stop listening
          } else if (url) {
            // We have a Stripe URL, redirect the user
            window.location.href = url;
            // No need to set loading false, we are navigating away
            unsubscribe(); // Stop listening
          }
        }
      });

    } catch (err) {
      console.error("Error creating checkout session:", err);
      setError(`Failed to start subscription: ${(err as Error).message}`);
      setIsBillingLoading(false);
    }
    // Note: We don't set isBillingLoading to false here,
    // because the onSnapshot listener will handle it (or we navigate away)
  };

  // --- URL Handling Logic ---
  const handleUrlChange = useCallback((path: string, params: URLSearchParams, newState?: { article?: Article | null }) => {
    console.log(`DEBUG: handleUrlChange - CALLED with path: ${path}. auth: ${authState}, subLoading: ${isSubLoading}`);
    
    let nextView: AppView | null = null; // Use null to detect if a branch was hit

    // --- FIX: Check for public routes FIRST ---
    if (path.startsWith('/terms')) {
      nextView = 'TERMS';
    } else if (path.startsWith('/privacy')) {
      nextView = 'PRIVACY';
    } else if (path.startsWith('/pricing')) {
      nextView = 'PRICING';
    }
    // --- END FIX ---

    // Handle authentication and loading states second
    else if (authState !== 'SIGNED_IN') { // Note the 'else if'
      if (authState === 'SIGNED_OUT') {
        console.log("Setting view to LANDING");
        nextView = 'LANDING';
      } else {
        console.log("Auth not ready, setting view to LOADING");
        nextView = 'LOADING'; // Set loading until auth is ready
      }
    } else { // User is SIGNED_IN
        // --- Signed-In Routing Logic ---
        
        if (path.startsWith('/lesson')) {
          const urlParam = params.get('url');
          const articleForCheck = newState?.article !== undefined ? newState.article : currentArticle;

          // --- NEW: Check persisted step on lesson load/refresh ---
          if (articleForCheck && urlParam === articleForCheck.link) {
            if (articleForCheck.link !== guidedLessonId) {
              console.log("Lesson on refresh doesn't match persisted step ID. Resetting step to 0.");
              setGuidedLessonStep(0);
              setGuidedLessonId(articleForCheck.link);
            } else {
              console.log(`Lesson on refresh matches persisted step ID. Step ${guidedLessonStep} is correct.`);
            }
          }

          if (urlParam && currentLesson && articleForCheck && articleForCheck.link === urlParam) {
            nextView = 'LESSON_VIEW';
          } else if (urlParam && articleForCheck && articleForCheck.link === urlParam) {
            nextView = 'LESSON_VIEW';
            if (!currentLesson && !isApiLoading) {
              handleSelectArticle(articleForCheck!, true);
            }
          } else {
            // If articleForCheck exists but doesn't match, or no urlParam, go to input
            console.warn("Lesson URL/State mismatch or invalid URL, navigating to input.");
            goToInput(); // Triggers navigation, handleUrlChange will run again for '/'
            return; // Stop processing this path
          }
        } else if (path.startsWith('/search')) {
          const query = params.get('q');
          const level = params.get('level') as EnglishLevel;

          if (query && level) {
            nextView = 'NEWS_LIST';
            // Only trigger search if state doesn't match URL and not already loading
            if ((!visibleNewsResults.length || inputTopic !== query || inputLevel !== level) && !isApiLoading) {
              setInputTopic(query);
              setInputLevel(level);
              handleFindArticles(query, true); // skip nav=true
            } else if (inputTopic !== query || inputLevel !== level) {
               // Sync state even if results are present (e.g., level changed in URL)
               setInputTopic(query);
               setInputLevel(level);
            }
          } else {
            console.warn("Invalid search URL, navigating to input.");
            goToInput(); // Triggers navigation
            return; // Stop processing this path
          }
        } else if (path.startsWith('/new')) { // <-- ADD THIS ELSE IF BLOCK
          nextView = 'INPUT';
        } else if (path.startsWith('/wordbank')) { // <-- ADD THIS BLOCK
          nextView = 'WORD_BANK';
        }
        // --- REMOVED /pricing, /terms, /privacy from this 'else' block ---
        else { // Default path '/'
          nextView = 'DASHBOARD'; // <-- CHANGE HERE
        }

        // Check if lesson summary audio needs fetching (inside signed in block)
        if (path.startsWith('/lesson') && authState === 'SIGNED_IN') {
            const urlParam = params.get('url');
            const articleForCheck = newState?.article !== undefined ? newState.article : currentArticle;

            if (urlParam && currentLesson && articleForCheck && articleForCheck.link === urlParam) {
                // Lesson and article match URL, check if audio needs fetching
                if (currentLesson.summary && !summaryAudioSrc && !isSummaryAudioLoading) {
                   console.log("handleUrlChange: Fetching summary audio for existing lesson on nav/refresh.");
                   fetchSummaryAudio(currentLesson.summary, targetLanguage);
                }
            }
         }
    } // End of SIGNED_IN else block

    // Always call setCurrentView if a nextView was determined.
    if (nextView) {
      if (nextView !== currentView) {
          console.log("Setting currentView to:", nextView);
          setCurrentView(nextView);
      } else {
          console.log("View already set to:", nextView, "Calling setCurrentView anyway.");
          // Call setter even if the value is the same to ensure component update cycle runs
          setCurrentView(nextView);
      }
    }

  }, [
    authState, currentLesson, currentArticle, visibleNewsResults, inputTopic, inputLevel, isApiLoading,
    setCurrentView, setInputTopic, setInputLevel, setError, setAllFetchedArticles, setVisibleNewsResults, setCurrentArticle, setCurrentLesson,
    handleSelectArticle, handleFindArticles, goToInput,
    fetchSummaryAudio, summaryAudioSrc, isSummaryAudioLoading,
    targetLanguage, uiLanguage
  ]);

  // --- NEW: Effect for SEO and Title Localization ---
  useEffect(() => {
    const title = t('common.appTitle');
    const description = t('common.appDescription');
    
    if (title && title !== 'common.appTitle') { // Check if key resolved
      document.title = title;
      document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
    }
    if (description && description !== 'common.appDescription') { // Check if key resolved
      document.querySelector('meta[name="description"]')?.setAttribute('content', description);
      document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
    }
    // Set html lang attribute
    document.documentElement.lang = i18n.language;

  }, [i18n.language, t]); // Re-run when language changes or t function is ready

  // --- Update the ref with the latest handler ---
  useEffect(() => {
    handleUrlChangeRef.current = handleUrlChange;
  }, [handleUrlChange]);

  // --- Effect for Initial Load and Back/Forward ---
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
        const { pathname, search } = window.location;
        // Use the ref to call the latest handler on popstate
        handleUrlChangeRef.current(pathname, new URLSearchParams(search));
    };
    window.addEventListener('popstate', handlePopState);

    console.log(`DEBUG: Initial Load useEffect - auth: ${authState}, subLoading: ${isSubLoading}, initialHandled: ${initialUrlHandled.current}`);

    // New condition: Auth must be ready, AND either the user is SIGNED_OUT OR subscription has finished loading.
    const authReadyAndSubCheckPassed = authState !== 'LOADING' && 
                                       (authState === 'SIGNED_OUT' || !isSubLoading);

    // Handle initial load once auth is ready AND subscription status is known
    if (authReadyAndSubCheckPassed && !initialUrlHandled.current) { 
        console.log("DEBUG: Initial Load useEffect - CONDITION MET. Running handler.");
        initialUrlHandled.current = true;
        const { pathname, search } = window.location;
        handleUrlChangeRef.current(pathname, new URLSearchParams(search));
    }

    return () => {
        window.removeEventListener('popstate', handlePopState);
    };
  }, [authState, isSubLoading]);

  // --- NEW: Memoized filter for lesson history ---
  const filteredLessonHistory = useMemo(() => {
    if (!dashboardSearchTerm.trim()) {
      return lessonHistory; // No filter, return all
    }
    const lowerCaseSearch = dashboardSearchTerm.toLowerCase();
    
    return lessonHistory.filter(lesson =>
      // Check title
      lesson.lessonData.articleTitle.toLowerCase().includes(lowerCaseSearch) ||
      // Check topic
      lesson.topic.toLowerCase().includes(lowerCaseSearch) ||
      // Check source
      (lesson.source && lesson.source.toLowerCase().includes(lowerCaseSearch))
    );
  }, [lessonHistory, dashboardSearchTerm]);

  // --- NEW: Memoized filter for grouping word bank ---
 const groupedWordBank = useMemo(() => {
   console.log("Grouping word bank...");
   // Group words by their targetLanguage
   return wordBank.reduce((acc, word) => {
     // Fallback for any old words that might not have the property
     const lang = word.targetLanguage || 'en'; 
     if (!acc[lang]) {
       acc[lang] = [];
     }
     acc[lang].push(word);
     return acc;
   }, {} as Record<LanguageCode, SavedWord[]>);
 }, [wordBank]);

 // --- NEW: Memoized list of words based on the filter ---
 const wordsForPractice = useMemo(() => {
   if (wordBankLanguageFilter === 'all') {
     return wordBank; // Return all words
   }
   // Return only words for the selected language
   return groupedWordBank[wordBankLanguageFilter as LanguageCode] || [];
 }, [wordBank, wordBankLanguageFilter, groupedWordBank]);

  // --- Auth state listener ---
   useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        console.log(`DEBUG: onAuthStateChanged - SIGNED_IN as ${currentUser.uid}`);
        setUser(currentUser);
        setAuthState('SIGNED_IN');
        setIsUserConfigLoading(true); // <-- START loading config
        fetchSubscriptionStatus(currentUser);
        setError(null);

        // --- NEW: Load user language preferences ---
        const userDocRef = doc(db, 'users', currentUser.uid);
        getDoc(userDocRef).then(docSnap => {
            if (docSnap.exists()) {
              const data = docSnap.data();
              // Only set if they exist, otherwise keep localStorage/default
              if (data.uiLanguage && languageCodes.includes(data.uiLanguage)) {
                setUiLanguage(data.uiLanguage);
              }
              if (data.targetLanguage && languageCodes.includes(data.targetLanguage)) {
                setTargetLanguage(data.targetLanguage);
              }
              // --- NEW: Load language levels ---
              if (data.languageLevels) {
                  // Merge defaults with loaded data to ensure all languages have a level
                  setLanguageLevels(prev => ({
                    ...defaultLevels, // Start with all defaults from code
                    ...data.languageLevels // Override with user's saved data
                  }));
              } else {
                  // No levels saved, use defaults (which useLocalStorageState should handle, but this is safer)
                  setLanguageLevels(defaultLevels);
              }
            }
            // --- FIX: This MUST be outside the 'if' block ---
            // Always set loading to false, even if doc doesn't exist (new user)
            setIsUserConfigLoading(false); 
        }).catch(err => {
            // This isn't critical, so just log a warning
            console.warn("Could not load user language preferences:", err);
            setIsUserConfigLoading(false); // <-- Also stop on error
        });
        // --- END NEW ---

      } else {
        console.log("DEBUG: onAuthStateChanged - SIGNED_OUT");
        setUser(null);
        setAuthState('SIGNED_OUT');
        // setCurrentView('SIGN_OUT'); // This will be handled by URL/popstate handler
        setLessonHistory([]);
        setLiveChatUsageCount(null); // Clear usage on sign out
        setIsUsageLoading(true); // Reset usage loading
        setWordBank([]);
        setDashboardSearchTerm('');
        initialUrlHandled.current = false;
        setIsUserConfigLoading(true); // <-- Reset on sign-out
        
        // --- ADDITION: Re-run URL handler on sign-out ---
        // This ensures the URL handler sees SIGNED_OUT state and shows login
        const { pathname, search } = window.location;
        handleUrlChangeRef.current(pathname, new URLSearchParams(search));
        // --- END ADDITION ---
      }
    });
    return () => unsubscribe();
  }, [auth, setCurrentView, fetchSubscriptionStatus, db]); // Added db as it's used in the effect

  // --- NEW: Real-time data listeners ---
  useEffect(() => {
    if (user) {
      // --- Set up Lesson History listener ---
      setIsHistoryLoading(true);
      const lessonsRef = collection(db, `users/${user.uid}/lessons`);
      const lessonsQuery = query(lessonsRef, orderBy("createdAt", "desc"), limit(50));
      const historyUnsubscribe = onSnapshot(lessonsQuery, 
        (querySnapshot) => {
          const lessons = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          } as SavedLesson));
          setLessonHistory(lessons);
          setIsHistoryLoading(false);
        }, 
        (err) => {
          console.error("Error fetching lesson history:", err);
          setError(`Failed to load lesson history: ${(err as Error).message}`);
          setIsHistoryLoading(false);
        }
      );

      // --- Set up Word Bank listener ---
      setIsWordBankLoading(true);
      const wordsRef = collection(db, `users/${user.uid}/wordBank`);
      const wordsQuery = query(wordsRef, orderBy("createdAt", "desc"));
      const wordBankUnsubscribe = onSnapshot(wordsQuery,
        (querySnapshot) => {
          const words = querySnapshot.docs.map(doc => doc.data() as SavedWord);
          setWordBank(words);
          setIsWordBankLoading(false);
        },
        (err) => {
          console.error("Error fetching word bank:", err);
          setError(`Failed to load word bank: ${(err as Error).message}`);
          setIsWordBankLoading(false);
        }
      );

      // --- Set up Live Chat Usage listener ---
      setIsUsageLoading(true);
      const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
      const usageDocRef = doc(db, `users/${user.uid}/liveChatUsage`, today);
      
      const usageUnsubscribe = onSnapshot(usageDocRef, 
        (docSnap) => {
          if (docSnap.exists()) {
            setLiveChatUsageCount(docSnap.data().count || 0);
          } else {
            // No doc for today means 0 uses
            setLiveChatUsageCount(0);
          }
          setIsUsageLoading(false);
        },
        (err) => {
          console.error("Error fetching live chat usage:", err);
          setError(`Failed to load usage data: ${(err as Error).message}`);
          setLiveChatUsageCount(null); // Set to null on error
          setIsUsageLoading(false);
        }
      );

       // --- Return cleanup function ---
       return () => {
         historyUnsubscribe();
         wordBankUnsubscribe();
        usageUnsubscribe(); // Detach usage listener
       };
     }
   }, [user, db]); // This effect re-runs when the user logs in or out

  // --- NEW: Effect to save language preferences to Firestore ---
  useEffect(() => {
   // Use an async IIFE to allow awaiting the setDoc call
   (async () => {
     // --- FIX: Do not save until config has finished loading! ---
     if (user && db && !isUserConfigLoading) { // <-- MUST HAVE !isUserConfigLoading
       const userDocRef = doc(db, 'users', user.uid);
       console.log("Attempting to save user preferences...", { uiLanguage, targetLanguage, languageLevels });
       try {
         // Use setDoc with merge: true to create/update the document
         await setDoc(userDocRef, {
           uiLanguage: uiLanguage,
           targetLanguage: targetLanguage,
           languageLevels: languageLevels
         }, { merge: true });
         console.log("User preferences saved successfully.");
       } catch (err) {
         // This will now catch security rule violations
         console.error("!!! FAILED to save user preferences:", err);
       }
     }
   })();
  }, [user, uiLanguage, targetLanguage, languageLevels, db, isUserConfigLoading]);

  // --- NEW: Track activity type in a ref to break dependency cycle ---
  useEffect(() => {
    lastActivityTypeRef.current = activityState?.type || null;
  }, [activityState?.type]);

  // --- NEW: Callback to increment live chat usage ---
  const handleIncrementLiveChatUsage = useCallback(async () => {
    if (!user) throw new Error("User not signed in.");

    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const usageDocRef = doc(db, `users/${user.uid}/liveChatUsage`, today);

    try {
      // Atomically increment the count. Creates the doc if it doesn't exist.
      await setDoc(usageDocRef, { count: increment(1) }, { merge: true });
    } catch (err) {
      logger.error("Failed to increment live chat usage:", err);
      throw new Error("Failed to update usage count.");
    }
  }, [user, db]); // Add 'db' as 

  const handleSaveArticle = useCallback(async (article: Article) => {
    if (!user || isLikingArticle) return;

    setIsLikingArticle(article.link);
    setArticleFeedbackMessage(null);
    setError(null);

    try {
      await authenticatedFetch('saveArticleForLater', {
        article,
        level: inputLevel,
        topic: inputTopic,
        uiLanguage: uiLanguage,
      });
      // The Firestore listener will automatically update the lessonHistory
      // which will make the "like" button appear solid.
      setArticleFeedbackMessage(`Saved "${article.title}" to your dashboard.`);
    } catch (e) {
      setError(`Could not save article: ${(e as Error).message}`);
    } finally {
      setIsLikingArticle(null);
      // Clear message after a few seconds
      setTimeout(() => setArticleFeedbackMessage(null), 3000);
    }
  }, [user, isLikingArticle, inputLevel, inputTopic, uiLanguage, authenticatedFetch, setError]);

  const handleGenerateGrammarExample = useCallback(async () => {
      if (!currentLesson?.grammarFocus?.topic || isGeneratingExample) return;

      setIsGeneratingExample(true);
      setError(null);

      try {
        const result = await authenticatedFetch('handleActivity', {
          activityType: 'grammar_example',
          payload: {
            topic: currentLesson.grammarFocus.topic,
            explanation: currentLesson.grammarFocus.explanation || '', // Send explanation for context
            level: inputLevel,
            uiLanguage: uiLanguage,
            targetLanguage: targetLanguage
          }
        });
        
        if (result.example) {
          setGeneratedGrammarExamples(prev => [...prev, result.example]);
        } else {
          throw new Error("AI did not return a new example.");
        }

      } catch (e) {
        setError(`Failed to generate new example: ${(e as Error).message}`);
      } finally {
        setIsGeneratingExample(false);
      }
    }, [
       currentLesson, isGeneratingExample, inputLevel, uiLanguage,
       targetLanguage, authenticatedFetch, setError, setGeneratedGrammarExamples
    ]);

  const handleTranslateArticle = useCallback(async (article: Article) => {
      const articleId = article.link;

      // If already translated, just toggle the view
      if (translatedArticles[articleId]) {
        setToggledTranslations(prev => ({
          ...prev,
          [articleId]: !prev[articleId]
        }));
        return;
      }

      // If not translated, fetch it
      setIsTranslating(articleId);
      setError(null);

      try {
        const result = await authenticatedFetch('handleActivity', {
          activityType: 'translate_article_content',
          payload: {
            title: article.title,
            snippet: article.snippet || '',
            uiLanguage: uiLanguage,
            targetLanguage: targetLanguage
          }
        });

        if (result.translatedTitle) {
          // Add to cache
          setTranslatedArticles(prev => ({
            ...prev,
            [articleId]: {
              translatedTitle: result.translatedTitle,
              translatedSnippet: result.translatedSnippet || ''
            }
          }));
          // Toggle it on
          setToggledTranslations(prev => ({
            ...prev,
            [articleId]: true
          }));
        } else {
          throw new Error("AI did not return a translation.");
        }

      } catch (e) {
        setError(`Failed to translate article: ${(e as Error).message}`);
      } finally {
        setIsTranslating(null);
      }
    }, [
      translatedArticles, authenticatedFetch, uiLanguage, 
      targetLanguage, setError, setTranslatedArticles, setToggledTranslations
    ]);

  const handleFetchComprehensionAnswer = useCallback(async (question: string, index: number) => {
    if (isAnswerLoading === index || comprehensionAnswers[index]) return; // Already loading or already have it
    
    setIsAnswerLoading(index);
    setError(null);

    try {
      const result = await authenticatedFetch('generateComprehensionAnswer', {
        question: question,
        summary: currentLesson?.summary,
        uiLanguage: uiLanguage
      });
      if (result.answer) {
        setComprehensionAnswers(prev => ({ ...prev, [index]: result.answer }));
      }
    } catch (e) {
      setError(`Failed to get answer: ${(e as Error).message}`);
    } finally {
      setIsAnswerLoading(null);
    }
  }, [isAnswerLoading, comprehensionAnswers, currentLesson?.summary, uiLanguage, authenticatedFetch, setError]);

  // --- NEW: Handler for "Disliking" an article ---
  const handleDislikeArticle = useCallback(async (articleToDislike: Article) => {
  if (!user || isDislikingArticle === articleToDislike.link) return; // Prevent double-clicks

  setIsDislikingArticle(articleToDislike.link);
  setArticleFeedbackMessage(null);
  setError(null);

  try {
    // --- 1. Remove from Firestore (if it exists) ---
    await authenticatedFetch('removeLesson', {
      articleUrl: articleToDislike.link
    });

    // --- 2. & 3. Update local visible state ATOMICALLY ---
    setVisibleNewsResults(prevVisible => {
      // Filter out the disliked article
      const filteredList = prevVisible.filter(a => a.link !== articleToDislike.link);

      let newReplacementIndex = replacementIndex; // Get index from state
      let replacementArticle: NewsResult | null = null;

      // Find next valid article from the full list
      while(newReplacementIndex < allFetchedArticles.length) {
          const potentialArticle = allFetchedArticles[newReplacementIndex];

          // Check if it's already visible FOR SOME REASON
          // (e.g. user liked it from a previous session)
          const isAlreadyVisible = prevVisible.some(a => a.link === potentialArticle.link);

          if (!isAlreadyVisible) {
              replacementArticle = potentialArticle;
              newReplacementIndex++; // Increment index for *next* time
              break; // Found one
          }
          newReplacementIndex++; // Skip this one, try next
      }

      setReplacementIndex(newReplacementIndex); // Save new index to state/localStorage

      if (replacementArticle) {
          return [...filteredList, replacementArticle];
      }

      return filteredList; // List will shrink if no replacements left
    });

  } catch (e) {
    setError(`Error disliking article: ${(e as Error).message}`);
  } finally {
    setIsDislikingArticle(null);
  }
}, [
    user, isDislikingArticle, allFetchedArticles, authenticatedFetch, setError, 
    setVisibleNewsResults, replacementIndex, setReplacementIndex // <-- Ensure new dependencies are added
]);

  // --- Google Sign-In Handler ---
  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      initialUrlHandled.current = false; // <-- ADD THIS LINE
      setAuthState('LOADING'); // Show loading during popup
      await signInWithPopup(auth, provider);
      // onAuthStateChanged will handle setting user and SIGNED_IN state and trigger URL check
    } catch (e) {
      console.error("Google Sign-In Error:", e);
      setError(`Google Sign-In failed: ${(e as Error).message}`);
      setAuthState('SIGNED_OUT'); // Revert state on failure
    }
  };

  // --- Sign Out Handler ---
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      // onAuthStateChanged will handle setting user to null and SIGNED_OUT state
      // Clear potentially sensitive state on sign out
      setCurrentArticle(null);
      setComprehensionAnswers({});
      setAllFetchedArticles([]);
      setVisibleNewsResults([]);
      setCurrentLesson(null);
      setInputTopic(''); // Optionally clear topic
    } catch (e) {
      console.error("Sign Out Error:", e);
      setError(`Sign out failed: ${(e as Error).message}`);
    }
  };

  // This function is now stable
  const handleClearChat = useCallback(() => {
    console.log("DEBUG_APP: handleClearChat called");
    setChatHistory([]);
    setChatError(null);
  }, [setChatHistory, setChatError]);

  const handleChatSubmit = useCallback(async (userInput: string) => {
    if (!userInput.trim() || !currentLesson || isChatLoading) return;

    console.log("DEBUG_APP: handleChatSubmit called with:", userInput);
    setIsChatLoading(true);
    setChatError(null);
    
    const userMessage: ChatMessage = { role: 'user', text: userInput };
    const newHistory = [...chatHistory, userMessage];
    
    const trimmedHistory = newHistory.length > CHAT_HISTORY_LIMIT 
      ? newHistory.slice(newHistory.length - CHAT_HISTORY_LIMIT)
      : newHistory;
    
    setChatHistory(trimmedHistory);
  
    try {
      const response = await authenticatedFetch('chatWithAssistant', {
        lessonData: currentLesson,
        chatHistory: newHistory,
        uiLanguage: uiLanguage,
        targetLanguage: targetLanguage
      });
  
      if (response.text) {
        const modelMessage: ChatMessage = { role: 'model', text: response.text };
        setChatHistory(prev => {
          const updatedHistory = [...prev, modelMessage];
          return updatedHistory.length > CHAT_HISTORY_LIMIT
            ? updatedHistory.slice(updatedHistory.length - CHAT_HISTORY_LIMIT)
            : updatedHistory;
        });
      } else {
        throw new Error(response.error || "The assistant did not provide a response.");
      }
    } catch (e) {
      const errorMsg = `Error: ${(e as Error).message}`;
      setChatError(errorMsg);
      setChatHistory(prev => [...prev, { role: 'model', text: errorMsg }]);
    } finally {
      setIsChatLoading(false);
    }
  }, [ // Add all dependencies
    currentLesson, isChatLoading, chatHistory, setChatHistory, 
    authenticatedFetch, uiLanguage, targetLanguage, setChatError, setIsChatLoading
  ]);

  // --- Wrap shuffleArray in useCallback ---
  const shuffleArray = useCallback(<T,>(array: T[]): T[] => {
    let currentIndex = array.length, randomIndex;
    while (currentIndex !== 0) {
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex--;
      [array[currentIndex], array[randomIndex]] = [
        array[randomIndex], array[currentIndex]];
    }
    return array;
  }, []); // Stable reference needed for dependency array

    // --- NEW: Define steps for Guided Lesson ---
  // We define this here so `startActivity` can use it
  const steps = useMemo(() => [
     { name: t('lesson.summaryTitle'), type: 'content' as const, activity: null },
     { name: t('lesson.vocabBuilder'), type: 'content' as const, activity: null },
     { name: t('activity.vocab'), type: 'activity' as const, activity: 'vocab' as ActivityState['type'] },
     { name: t('lesson.grammarFocus'), type: 'content' as const, activity: null },
     { name: t('activity.grammar'), type: 'activity' as const, activity: 'grammar' as ActivityState['type'] },
     { name:t('lesson.comprehensionQuestions'), type: 'content' as const, activity: null },
     { name: t('activity.comprehension'), type: 'activity' as const, activity: 'comprehension' as ActivityState['type'] },
     { name: t('activity.writing'), type: 'activity' as const, activity: 'writing' as ActivityState['type'] },
     { name: t('common.finish'), type: 'content' as const, activity: null }
  ], [t]);

    // --- NEW: Activity Logic ---
    const startActivity = useCallback((type: ActivityType) => {
      if (!currentLesson) return;
      activityCancellationRef.current = false; // <<< ADD THIS LINE: Reset cancellation flag
      // --- NEW: If starting from guided mode, set step ---
      if (lessonViewMode === 'guided') {
        const stepIndex = steps.findIndex(s => s.activity === type);
        if (stepIndex !== -1) {
          setGuidedLessonStep(stepIndex);
        }
      }
      setError(null);
      let totalItems = 0;
      let shuffledIndices: number[] | undefined = undefined; // <-- Initialize here

      if (type === 'vocab') {
        totalItems = currentLesson.vocabularyList.length;
        if (totalItems > 0) {
          // --- Create and shuffle indices ---
          const indices = Array.from(Array(totalItems).keys()); // [0, 1, 2, ..., totalItems-1]
          shuffledIndices = shuffleArray(indices); // Shuffle the indices
          console.log("Shuffled vocab indices:", shuffledIndices); // Log shuffled order
          // --- End shuffling ---
        }
      }
      if (type === 'grammar') totalItems = 5;
      if (type === 'comprehension') totalItems = currentLesson.comprehensionQuestions.length;
      if (type === 'writing') totalItems = 1;

      if (totalItems === 0) {
          setError(t('activity.noItemsError', { type }));
          return;
      }

     setActivityState({
      type: type,
      index: 0,
      score: 0,
      total: totalItems,
      shuffledIndices: shuffledIndices,
      currentData: null, // Will be loaded by useEffect
      userAnswer: null,
      feedback: { isCorrect: null, message: '' },
      isSubmitting: true, // Start in loading state
    });
      setCurrentView('ACTIVITY');
    }, [currentLesson, shuffleArray, setError, t, lessonViewMode, setGuidedLessonStep, steps, setActivityState, setCurrentView]);

    const quitActivity = useCallback(async () => {
      activityCancellationRef.current = true; // Signal cancellation

      const lastActivityType = lastActivityTypeRef.current;
      console.log("last activity type: " + lastActivityType); // Your debug log

      const justFinishedGuidedLesson = lessonViewMode === 'guided' && guidedLessonStep === (steps.length - 1);
      if (user && currentArticle && justFinishedGuidedLesson) {
        console.log("Guided lesson finished. Marking as complete in Firestore.");
        try {
          const lessonDocId = btoa(currentArticle.link)
            .replace(/\//g, '_')
            .replace(/\+/g, '-');
          const lessonDocRef = doc(db, `users/${user.uid}/lessons`, lessonDocId);
          await setDoc(lessonDocRef, {
            guidedCompleted: true, // Our new accountability flag
            lastCompletedAt: Timestamp.now() // Track when
          }, { merge: true });
        } catch (err) {
          console.warn("Could not mark lesson as complete:", err);
          // Don't block the user, just log the error
        }
      }

      // --- FIX: Only reset step/view if quitting from GUIDED mode ---
      if (lessonViewMode === 'guided') {
        setGuidedLessonStep(0); // This now saves to localStorage
        setLessonViewMode('overview'); // Default back to overview
      }
      setActivityState(null);

      // Stop and clear any active activity audio
      if (activityAudioRef.current) {
          activityAudioRef.current.pause();
          activityAudioRef.current = null;
      }
      setIsActivityAudioLoading(false); // Reset loading state
      setActivityAudioError(null);    // Reset error state

      // Navigate based on the last activity type
      if (lastActivityType === 'wordbank_study' || lastActivityType === 'wordbank_review') {
          navigate('/wordbank'); // Go to Word Bank
      } else if (lastActivityType === 'grammar_standalone' || lastActivityType === 'writing_standalone') { // <-- ADD THIS ELSE IF
          navigate('/'); // Go to Dashboard
      } else {
          // Default to lesson view for all other types
          if (currentArticle) {
            goToLesson(currentArticle); // Go back to the lesson URL
          } else {
            navigate('/'); // Fallback to dashboard
          }
      }
  }, [
      setActivityState, setIsActivityAudioLoading, setActivityAudioError, navigate, currentArticle, goToLesson,
      lessonViewMode, setGuidedLessonStep, setLessonViewMode,
      guidedLessonStep, steps, user, db
  ]);

  // --- NEW: Logic to move to the next GUIDED step ---
   const handleNextGuidedStep = useCallback(() => {
     // This function is for the guided lesson flow
     const newStep = guidedLessonStep + 1;
     if (newStep >= steps.length) {
       quitActivity(); // Finished the last step
     } else {
       setGuidedLessonStep(newStep);
       setActivityState(null); // Clear old activity state
       setCurrentView('LESSON_VIEW'); // <-- THE FIX: Go back to the lesson view
     }
   }, [guidedLessonStep, steps, quitActivity, setGuidedLessonStep, setActivityState, setCurrentView]);
 
   // --- NEW: Logic for "Next" button in an activity ---
   const handleNextActivityQuestion = useCallback(() => {
     // This function is for *within* an activity
     setActivityState(prev => {
        if (!prev) return null; // Should not happen
 
        // This is the new part: check view mode
        if (lessonViewMode === 'guided') {
          // In guided mode, finishing the quiz moves to the next *step*
          if (prev.index + 1 >= prev.total) {
            handleNextGuidedStep();
            return null; // The step change will handle the rest
          }
        } else {
          // In overview (modal) mode, finishing the quiz just quits
          if (prev.index + 1 >= prev.total) {
            quitActivity();
            return null;
          }
        }
 
        // Not finished, just go to the next question in the quiz
        return {
            ...prev,
            index: prev.index + 1,
            currentData: null, // Will trigger useEffect to load/generate next
            userAnswer: null,
            feedback: { isCorrect: null, message: '' }
        };
    });
   }, [lessonViewMode, handleNextGuidedStep, quitActivity, setActivityState]);

  // Effect to load data for the current activity step (REVISED AGAIN - Simpler Loading Logic)
  useEffect(() => {
    // --- ADD THIS CHECK ---
    const isStandalone = activityState?.type === 'grammar_standalone' || activityState?.type === 'writing_standalone';

    // --- Early exit if not in the right view or state is missing ---
    // FIX: Allow standalone activities to run even if currentLesson is null
    if (currentView !== 'ACTIVITY' || !activityState || (!currentLesson && !isStandalone)) {
      console.log("Activity useEffect: Bailing early (not in activity view, missing state, or missing lesson for non-standalone activity)");
      return;
    }

    const { type, index, total, shuffledIndices, currentData, isSubmitting, practiceTopic } = activityState;
    const currentStepKey = `${type}-${index}`; // Unique identifier for this step

    // --- Handle activity completion ---
    if (index >= total) {
      console.log(`Activity finished check: index ${index} >= total ${{total}}.`);
      // Only update state if not already marked as finished
      if (!currentData?.finished) {
        setActivityState(prev => {
          if (!prev || prev.index !== index) return prev; // Check relevance
          if (prev.currentData?.finished) return prev; // Already marked
          console.log("Setting finished state.");
          return { ...prev, currentData: { finished: true }, isSubmitting: false }; // Ensure loading is off
        });
      }
      return; // Done
    }

    // --- Check if data loading for this step is already complete OR actively loading ---
    if (currentData && currentData._stepIdentifier === currentStepKey) {
        console.log(`Activity useEffect: Data already loaded for ${currentStepKey}, exiting.`);
        return; // Data already present
    }
    if (loadingStepRef.current === currentStepKey) {
         console.log(`Activity useEffect: Fetch already in progress for ${currentStepKey} (ref check), exiting.`);
         return; // Fetch is already running for this exact step
    }
    // --- End Check ---


    console.log(`Activity useEffect: Proceeding to load data for ${currentStepKey}`);

    // --- Prepare Data (Sync or Async) ---
    let dataPromise: Promise<any>; // Use a promise to handle both sync and async paths

    // --- THIS IS THE MISSING BLOCK ---
    if (type === 'vocab' && shuffledIndices) {
      dataPromise = Promise.resolve().then(() => { // Wrap sync logic in resolved promise
        const actualItemIndex = shuffledIndices[index];
        if (actualItemIndex >= currentLesson.vocabularyList.length) throw new Error(`Invalid shuffled index ${actualItemIndex}`);
        const currentVocabItem = currentLesson.vocabularyList[actualItemIndex];
        if (!currentVocabItem || !currentVocabItem.word || !currentVocabItem.definition) throw new Error(`Invalid vocab item at index ${actualItemIndex}`);
        
        let dataForStep: any = { 
          word: currentVocabItem.word, 
          definition: currentVocabItem.definition,
          // Pass language codes for the speak button
          uiLanguage: uiLanguage, 
          targetLanguage: targetLanguage,
          question: currentVocabItem.definition // For the SpeakButton in ActivityContent
        };
        
        if (inputLevel !== 'Advanced') {
          const numOptions = inputLevel === 'Beginner' ? 2 : 4;
          const otherIndices = shuffledIndices.filter((_, i) => i !== index);
          const distractors = shuffleArray(otherIndices).slice(0, numOptions - 1).map(idx => currentLesson.vocabularyList[idx].word);
          dataForStep.options = shuffleArray([ currentVocabItem.word, ...distractors ]);
        }
        return dataForStep;
      });
    // --- END OF THE MISSING BLOCK ---
    } else if (type === 'comprehension') {
      dataPromise = Promise.resolve().then(() => { // Wrap sync logic in resolved promise
        if (index >= currentLesson.comprehensionQuestions.length) throw new Error(`Index ${index} out of bounds for comprehension`);
        const questionText = currentLesson.comprehensionQuestions[index];
        if (!questionText || typeof questionText !== 'string') throw new Error(`Invalid comprehension question at index ${index}`);
        return { question: questionText, summary: currentLesson.summary };
      });
    } else if (type === 'grammar_standalone') {
        console.log(`Setting loading ref and starting grammar_standalone fetch for ${currentStepKey}...`);
        loadingStepRef.current = currentStepKey;

        // Map numeric practice level (1-5) to API EnglishLevel string
        const numericLevel = practiceTopic?.level || 1;
        let effectiveLevel: EnglishLevel = 'Beginner';
        if (numericLevel >= 4) effectiveLevel = 'Advanced';
        else if (numericLevel >= 2) effectiveLevel = 'Intermediate';

        // --- NEW: Get previous questions for this topic ---
        const topicTitle = practiceTopic?.title || 'Unknown Topic';
        const previousQuestions = questionHistory[targetLanguage]?.[topicTitle] || [];
  
        const payload = {
          level: effectiveLevel,
          uiLanguage: uiLanguage,
          targetLanguage: targetLanguage,
          // --- ADD THIS ---
          topic: practiceTopic, // Pass the selected topic to the backend
          seed: Date.now(), // Add randomness to the prompt
          previousQuestions: previousQuestions // Pass history to backend
          // --- END ADDITION ---
        };
  
        dataPromise = authenticatedFetch('handleActivity', {
            activityType: 'grammar_standalone_generate',
            payload: payload
        }).then(fetchedData => {
          if (activityCancellationRef.current) { return Promise.reject(new Error("Activity cancelled")); }
          if (fetchedData?.question && fetchedData?.options) { 
             // --- NEW: Update question history ---
             setQuestionHistory(prev => {
                const langHistory = prev[targetLanguage] || {};
                const topicHistory = langHistory[topicTitle] || [];
                // Keep only the last 10 questions to prevent prompt bloat
                const newTopicHistory = [...topicHistory, fetchedData.question].slice(-10);
                return {
                    ...prev,
                    [targetLanguage]: {
                        ...langHistory,
                        [topicTitle]: newTopicHistory
                    }
                };
             });
             return fetchedData; 
          }
          else { throw new Error("Invalid grammar data received."); }
        });
    } else if (type === 'writing_standalone') {
        console.log(`Setting loading ref and starting writing_standalone fetch for ${currentStepKey}...`);
        loadingStepRef.current = currentStepKey;

        // Map numeric practice level (1-5) to API EnglishLevel string
        const numericLevel = practiceTopic?.level || 1;
        let effectiveLevel: EnglishLevel = 'Beginner';
        if (numericLevel >= 4) effectiveLevel = 'Advanced';
        else if (numericLevel >= 2) effectiveLevel = 'Intermediate';

        // --- NEW: Get previous prompts for this topic ---
        const topicTitle = practiceTopic?.title || 'Unknown Topic';
        const previousPrompts = questionHistory[targetLanguage]?.[topicTitle] || [];
  
        const payload = {
          level: effectiveLevel,
          uiLanguage: uiLanguage,
          targetLanguage: targetLanguage,
          // --- ADD THIS ---
          topic: practiceTopic, // Pass the selected topic to the backend
          seed: Date.now(), // Add randomness to the prompt
          previousQuestions: previousPrompts // Pass history (using same key)
          // --- END ADDITION ---
        };
  
        dataPromise = authenticatedFetch('handleActivity', {
            activityType: 'writing_standalone_generate',
            payload: payload
        }).then(fetchedData => {
          if (activityCancellationRef.current) { return Promise.reject(new Error("Activity cancelled")); }
          if (fetchedData?.prompt) { 
             // --- NEW: Update prompt history ---
             setQuestionHistory(prev => {
                const langHistory = prev[targetLanguage] || {};
                const topicHistory = langHistory[topicTitle] || [];
                // Keep only the last 10 prompts
                const newTopicHistory = [...topicHistory, fetchedData.prompt].slice(-10);
                return {
                    ...prev,
                    [targetLanguage]: {
                        ...langHistory,
                        [topicTitle]: newTopicHistory
                    }
                };
             });
             return fetchedData; 
          }
          else { throw new Error("Invalid writing prompt data received."); }
        });
    } else if (type === 'grammar') {
    console.log(`Setting loading ref and starting grammar fetch for ${currentStepKey}...`);
    loadingStepRef.current = currentStepKey;

    // *** ADD SAFETY CHECKS & LOGGING HERE ***
    const grammarPayload = {
        topic: currentLesson?.grammarFocus?.topic, // Use optional chaining
        explanation: currentLesson?.grammarFocus?.explanation, // Use optional chaining
        level: inputLevel,
        uiLanguage: uiLanguage,
        targetLanguage: targetLanguage
    };
    console.log("Attempting grammar generation with payload:", JSON.stringify(grammarPayload));

    // Explicitly check if essential parts are missing BEFORE sending the request
    if (!currentLesson || !grammarPayload.topic || !grammarPayload.explanation) {
        console.error("Cannot generate grammar question: currentLesson, topic, or explanation is missing.", { currentLessonExists: !!currentLesson, topic: grammarPayload.topic, explanation: grammarPayload.explanation });
        setError("Failed to prepare grammar activity data (missing topic/explanation). Please try returning to the lesson and starting the activity again.");
        // Use a Promise.reject to trigger the .catch block cleanly
        dataPromise = Promise.reject(new Error("Missing grammar topic/explanation"));
    } else {
    // *** END SAFETY CHECKS & LOGGING ***

        // Only proceed with the fetch if the payload is valid
        dataPromise = authenticatedFetch('handleActivity', {
            activityType: 'grammar_generate',
            payload: grammarPayload // Use the checked payload
        }).then(fetchedData => {
          // *** ADD CANCELLATION CHECK HERE ***
          if (activityCancellationRef.current) {
              console.log(`Grammar fetch successful for ${currentStepKey}, BUT activity was cancelled. Discarding.`);
              // Reject the promise chain so the .then(dataForStep => ...) block doesn't run
              return Promise.reject(new Error("Activity cancelled"));
          }
          // *** END CANCELLATION CHECK ***

          console.log(`Grammar fetch successful for ${currentStepKey}`);
          if (fetchedData?.question && fetchedData?.options) { return fetchedData; }
          else { throw new Error("Invalid grammar data received."); }
      });
    } // <-- Close the new else block
  // --- ADDITION: Logic for wordbank_study ---
  } else if (type === 'wordbank_study' && shuffledIndices) {
      dataPromise = Promise.resolve().then(() => {
        const actualItemIndex = shuffledIndices[index];
        if (actualItemIndex >= wordsForPractice.length) throw new Error(`Invalid shuffled word bank index ${actualItemIndex}`);
        const currentVocabItem = wordsForPractice[actualItemIndex];
        if (!currentVocabItem) throw new Error(`Invalid word bank item at index ${actualItemIndex}`);
        
        // Always fill-in-the-blank for word bank study
        return { 
          word: currentVocabItem.word, 
          definition: currentVocabItem.definition,
          uiLanguage: uiLanguage, // Pass UI lang for speak button
          targetLanguage: currentVocabItem.targetLanguage
        };
      });
    // --- END ADDITION ---

    // --- ADDITION: Logic for wordbank_review ---
  } else if (type === 'wordbank_review' && shuffledIndices) {
      dataPromise = Promise.resolve().then(() => {
        const actualItemIndex = shuffledIndices[index];
        if (actualItemIndex >= wordsForPractice.length) throw new Error(`Invalid shuffled word bank index ${actualItemIndex}`);
        const currentVocabItem = wordsForPractice[actualItemIndex];
        if (!currentVocabItem) throw new Error(`Invalid word bank item at index ${actualItemIndex}`);
        
        // Pass word, definition (for answer), and targetLanguage (for speak)
        return { 
          word: currentVocabItem.word, 
          definition: currentVocabItem.definition,
          targetLanguage: currentVocabItem.targetLanguage
        };
      });
    // --- END ADDITION ---

  } else if (type === 'writing') {
        console.log(`Setting loading ref and starting writing fetch for ${currentStepKey}...`);
        loadingStepRef.current = currentStepKey;

        const payload = {
          summary: currentLesson.summary,
          level: inputLevel,
          vocabularyList: currentLesson.vocabularyList.map(v => v.word),
          uiLanguage: uiLanguage,
          targetLanguage: targetLanguage
        };

        if (!payload.summary || !payload.level || !payload.vocabularyList) {
            console.error("Cannot generate writing prompt: missing summary, level, or vocab list.");
            setError("Failed to prepare writing activity data.");
            dataPromise = Promise.reject(new Error("Missing writing_generate payload data."));
        } else {
            dataPromise = authenticatedFetch('handleActivity', {
                activityType: 'writing_generate',
                payload: payload
            }).then(fetchedData => {
              if (activityCancellationRef.current) {
                  return Promise.reject(new Error("Activity cancelled"));
              }
              console.log(`Writing prompt fetch successful for ${currentStepKey}`);
              if (fetchedData?.prompt) { 
                // This is the fix to store the summary for later submission
                return { ...fetchedData, summary: currentLesson.summary }; 
              }
              else { throw new Error("Invalid writing prompt data received."); }
          });
        }
    } else {
      // Should not happen
      dataPromise = Promise.reject(new Error(`Unhandled activity type: ${type}`));
    }

    // --- Process the data promise ---
    dataPromise.then(dataForStep => {
     // *** ADD ANOTHER CANCELLATION CHECK (safety) ***
     if (activityCancellationRef.current) {
         console.log(`Final state update for ${currentStepKey} aborted: Activity cancelled.`);
         return; // Don't update state if cancelled
     }
     // *** END CANCELLATION CHECK ***

     if (loadingStepRef.current !== currentStepKey && (type === 'grammar' || type === 'writing' || type === 'grammar_standalone' || type === 'writing_standalone')) {
        console.log(`Data received for ${currentStepKey}, but loading ref changed or cleared. Discarding.`);
        return;
     }

     console.log(`Setting final currentData for step ${currentStepKey}`);
     setActivityState(prev => {
       if (!prev || prev.index !== index || prev.type !== type) return prev; // Relevance check
       
       console.log(`Executing final state update for ${currentStepKey}`);
       return {
         ...prev,
         currentData: { ...dataForStep, _stepIdentifier: currentStepKey },
         isSubmitting: false, // Ensure loading is off
         _loadingStepKey: null
       };
     });
   })
   .catch(error => {
       if ((error as Error).message === "Missing grammar topic/explanation" || (error as Error).message === "Missing writing_generate payload data.") {
           console.warn("Activity generation aborted due to missing data.");
           setActivityState(prev => {
               if (!prev || !(prev.index === index && prev.type === type && prev.isSubmitting)) return prev;
               return {...prev, isSubmitting: false, _loadingStepKey: null };
           });
           return; // Stop further error processing
       }
      if ((error as Error).message === "Activity cancelled") {
          console.log(`Caught cancellation signal for ${currentStepKey}. No error state needed.`);
          setActivityState(prev => {
              if (!prev || !(prev.index === index && prev.type === type && prev.isSubmitting)) return prev;
              return {...prev, isSubmitting: false, _loadingStepKey: null };
          });
          return; // Stop further error processing
      }

      console.error(`Error processing/fetching activity data for ${currentStepKey}:`, error);
      setError(`An error occurred: ${(error as Error).message}`);
      setActivityState(prev => {
         if (!prev || !(prev.index === index && prev.type === type)) return prev;
         return {...prev, isSubmitting: false, _loadingStepKey: null };
      });
      quitActivity(); // Exit activity on actual error
   })
   .finally(() => {
      if (loadingStepRef.current === currentStepKey) {
          console.log(`Clearing loading ref for ${currentStepKey}`);
          loadingStepRef.current = null;
      }
   });

    return () => {
        console.log(`Activity useEffect cleanup running for ${currentStepKey} (effect instance end)`);
        if (loadingStepRef.current === currentStepKey) {
            console.log(`Cleanup clearing loading ref for ${currentStepKey} because effect instance ended`);
            loadingStepRef.current = null;
        }
    };

  // Keep dependencies tight: Only re-run when the step fundamentally changes
  }, [
      // --- ADD 'practiceTopic' to dependency array ---
      currentView, activityState?.type, activityState?.index, activityState?.practiceTopic,
      activityState?.shuffledIndices,
      inputLevel, currentLesson,
      wordsForPractice,
      authenticatedFetch, quitActivity, setError, shuffleArray,
      uiLanguage, targetLanguage
  ]);

  const handleSubmitAnswer = useCallback(async () => {
      // --- MODIFY THIS GUARD CLAUSE ---
      if (!activityState || !activityState.currentData || activityState.feedback.isCorrect !== null) {
        console.warn("handleSubmitAnswer: Bailing early (no state/data, or feedback already given)");
        return; 
      }
      // --- END MODIFICATION ---

      // --- MOVE THIS BLOCK UP ---
      const { type, currentData, userAnswer, score } = activityState;
      // --- END MOVE ---

      // --- ADD THIS NEW GUARD CLAUSE ---
      // Now, check for userAnswer *unless* it's review mode
      if (type !== 'wordbank_review' && (userAnswer === null || userAnswer === '')) {
        console.warn("handleSubmitAnswer: Bailing (answer is null/empty on a non-review activity)");
        return;
      }
      // --- END ADDITION ---

      setActivityState(prev => prev ? ({ ...prev, isSubmitting: true }) : null);
      setError(null);

      try {
          // --- MOVE THESE DECLARATIONS HERE ---
          let isCorrect: boolean = false;
          let feedbackMsg: string = '';
          // --- END MOVE ---

          if (type === 'vocab') {
              // --- REMOVE THE OLD DECLARATIONS ---
              // isCorrect = String(userAnswer).trim().toLowerCase() === String(currentData.word).trim().toLowerCase();
              // feedbackMsg = isCorrect ? t('activity.correct') : t('activity.incorrectWord', { word: currentData.word });
              // --- END REMOVAL ---

              // --- REPLACE WITH ASSIGNMENTS ---
              const fullWordClean = String(currentData.word).trim().toLowerCase();
              const mainWordClean = String(currentData.word).split('(')[0].trim().toLowerCase();
              const userAnswerClean = String(userAnswer).trim().toLowerCase();

              isCorrect = (userAnswerClean === fullWordClean) || (userAnswerClean === mainWordClean);
              feedbackMsg = isCorrect ? t('activity.correct') : t('activity.incorrectWord', { word: currentData.word });
              // --- END ASSIGNMENTS ---

              // Optional: Add AI check for 'Advanced' level typos here if desired
              // if (inputLevel === 'Advanced' && !isCorrect) { ... call handleActivity ... }

              // Update state directly for vocab
              setActivityState(prev => {
                  if (!prev) return null;
                  const newScore = isCorrect ? prev.score + 1 : prev.score;
                  return {
                      ...prev,
                      feedback: { isCorrect: isCorrect, message: feedbackMsg },
                      score: newScore,
                      isSubmitting: false
                  };
              });
              // --- END MODIFICATION ---

          } else if (type === 'grammar') {
              // Grammar grading remains the same (uses backend)
              const result = await authenticatedFetch('handleActivity', {
                  activityType: 'grammar_grade',
                  payload: {
                      question: currentData.question,
                      options: currentData.options,
                      correctAnswer: currentData.correctAnswer,
                      userAnswer: String(userAnswer),
                      uiLanguage: uiLanguage
                  }
              });
              setActivityState(prev => {
                  if (!prev) return null;
                  const newScore = result.isCorrect ? prev.score + 1 : prev.score;
                  return {
                    ...prev,
                    feedback: { isCorrect: result.isCorrect, message: result.feedback || (result.isCorrect ? t('activity.correct') : 'Incorrect.') },
                    score: newScore,
                    isSubmitting: false
                  };
              });

          } else if (type === 'grammar_standalone') {
              const result = await authenticatedFetch('handleActivity', {
                  activityType: 'grammar_grade', // We can reuse the existing 'grammar_grade'
                  payload: {
                      question: currentData.question,
                      options: currentData.options,
                      correctAnswer: currentData.correctAnswer,
                      userAnswer: String(userAnswer),
                      uiLanguage: uiLanguage
                  }
              });
              setActivityState(prev => {
                  if (!prev) return null;
                  const newScore = result.isCorrect ? prev.score + 1 : prev.score;
                  return {
                    ...prev,
                    feedback: { isCorrect: result.isCorrect, message: result.feedback || (result.isCorrect ? t('activity.correct') : 'Incorrect.') },
                    score: newScore,
                    isSubmitting: false
                  };
              });
          } else if (type === 'comprehension') {
              // Comprehension grading remains the same (uses backend)
               const result = await authenticatedFetch('handleActivity', {
                  activityType: 'comprehension_grade',
                  payload: {
                      question: currentData.question,
                      summary: currentData.summary,
                      userAnswer: String(userAnswer),
                      uiLanguage: uiLanguage,
                      targetLanguage: targetLanguage,
                      level: inputLevel
                  }
               });
               setActivityState(prev => {
                   if (!prev) return null;
                   const newScore = result.isCorrect ? prev.score + 1 : prev.score;
                   return {
                     ...prev,
                     feedback: { isCorrect: result.isCorrect, message: result.feedback || (result.isCorrect ? t('activity.correct') : 'Incorrect.') },
                     score: newScore,
                     isSubmitting: false
                   };
               });
          } else if (type === 'writing') {
               const result = await authenticatedFetch('handleActivity', {
                  activityType: 'writing_grade',
                  payload: {
                      prompt: currentData.prompt,
                      summary: currentData.summary, // <-- This is the fix for the infinite load
                      userAnswer: String(userAnswer),
                      level: inputLevel,
                      uiLanguage: uiLanguage,
                      targetLanguage: targetLanguage
                  }
               });
               setActivityState(prev => {
                   if (!prev) return null;
                   // For writing, "isCorrect" is more of a "pass/fail". The feedback is what matters.
                   const newScore = result.isCorrect ? prev.score + 1 : prev.score;
                   return {
                     ...prev,
                     feedback: { isCorrect: result.isCorrect, message: result.feedback || (result.isCorrect ? 'Great job!' : 'Good try, see feedback.') },
                     score: newScore,
                     isSubmitting: false
                   };
               });

          } else if (type === 'writing_standalone') {
               const result = await authenticatedFetch('handleActivity', {
                  activityType: 'writing_standalone_grade', // We'll create this new backend case
                  payload: {
                      prompt: currentData.prompt,
                      userAnswer: String(userAnswer),
                      level: inputLevel,
                      uiLanguage: uiLanguage,
                      targetLanguage: targetLanguage
                  }
               });
               setActivityState(prev => {
                   if (!prev) return null;
                   // For writing, "isCorrect" is more of a "pass/fail". The feedback is what matters.
                   const newScore = result.isCorrect ? prev.score + 1 : prev.score;
                   return {
                     ...prev,
                     feedback: { isCorrect: result.isCorrect, message: result.feedback || (result.isCorrect ? 'Great job!' : 'Good try, see feedback.') },
                     score: newScore,
                     isSubmitting: false
                   };
               });
          } else if (type === 'wordbank_study') {
               // --- FIX: This was incorrectly calling 'writing_grade'. Replace with vocab logic. ---
              const fullWordClean = String(currentData.word).trim().toLowerCase();
              const mainWordClean = String(currentData.word).split('(')[0].trim().toLowerCase();
              const userAnswerClean = String(userAnswer).trim().toLowerCase();
   
              isCorrect = (userAnswerClean === fullWordClean) || (userAnswerClean === mainWordClean);
              feedbackMsg = isCorrect ? t('activity.correct') : t('activity.incorrectWord', { word: currentData.word });

              setActivityState(prev => {
                if (!prev) return null;
                const newScore = isCorrect ? prev.score + 1 : prev.score;
                return {
                    ...prev,
                    feedback: { isCorrect: isCorrect, message: feedbackMsg },
                    score: newScore,
                    isSubmitting: false
                  };
              });

          } else if (type === 'wordbank_study') {
            // --- REMOVE THE OLD DECLARATIONS ---
            // isCorrect = String(userAnswer).trim().toLowerCase() === String(currentData.word).trim().toLowerCase();
            // feedbackMsg = isCorrect ? t('activity.correct') : t('activity.incorrectWord', { word: currentData.word });
            // --- END REMOVAL ---
            
            // --- REPLACE WITH ASSIGNMENTS ---
            // --- FIX: Smart comparison for parentheticals (Hanja, Kanji, etc.) ---
            const fullWordClean = String(currentData.word).trim().toLowerCase();
            const mainWordClean = String(currentData.word).split('(')[0].trim().toLowerCase();
            const userAnswerClean = String(userAnswer).trim().toLowerCase();
 
            isCorrect = (userAnswerClean === fullWordClean) || (userAnswerClean === mainWordClean);
            feedbackMsg = isCorrect ? t('activity.correct') : t('activity.incorrectWord', { word: currentData.word });
            // --- END ASSIGNMENTS ---

            setActivityState(prev => {
              if (!prev) return null;
              const newScore = isCorrect ? prev.score + 1 : prev.score;
              return {
                  ...prev,
                  feedback: { isCorrect: isCorrect, message: feedbackMsg },
                  score: newScore,
                  isSubmitting: false
                };
            });
            // --- END ADDITION ---

      // --- ADDITION: Handle wordbank_review submission (just show answer) ---
      } else if (type === 'wordbank_review') {
          feedbackMsg = currentData.definition;
          isCorrect = true; // Use 'true' to show green/neutral feedback box

          setActivityState(prev => {
              if (!prev) return null;
              // No score change for review mode
              return {
                  ...prev,
                  feedback: { isCorrect: isCorrect, message: feedbackMsg },
                  isSubmitting: false
              };
          });
      // --- END ADDITION ---
          }

      

      } catch (err) {
        setError(`Error submitting answer: ${(err as Error).message}`);
        setActivityState(prev => prev ? ({ ...prev, isSubmitting: false }) : null);
      }
  }, [activityState, setActivityState, setError, t, authenticatedFetch, uiLanguage, targetLanguage, inputLevel, currentLesson]);

  // --- Activity Text-to-Speech Handler (Renamed) ---
  const handleActivityTextToSpeech = useCallback(async (text: string | undefined | null, langCode: LanguageCode) => { // Renamed function
    console.log(`handleActivityTextToSpeech called with lang: ${langCode}, text:`, text);

    if (!text || isActivityAudioLoading) { // Use renamed state variable
        console.log("handleActivityTextToSpeech returning early. Reason:", !text ? "No text" : "Activity audio loading");
        return;
    }
    // Stop OTHER audio if playing
    if (summaryAudioRef.current) {
        summaryAudioRef.current.pause();
        setIsSummaryPlaying(false);
    }
    if (activityAudioRef.current) { // Use renamed ref
        activityAudioRef.current.pause();
        activityAudioRef.current = null;
    }

    setIsActivityAudioLoading(true); // Use renamed state variable
    setActivityAudioError(null); // Use renamed state variable
    setError(null); // Clear main error

    try {
        const response = await authenticatedFetch('textToSpeech', { text,
            langCode: langCode });
        if (response.audioContent) {
            const audioData = `data:audio/mp3;base64,${response.audioContent}`;
            const audio = new Audio(audioData);
            activityAudioRef.current = audio; // Store reference in renamed ref
            audio.play().catch(e => {
                console.error("Activity audio play failed:", e);
                setActivityAudioError("Could not play audio."); // Use renamed state variable
            });
            audio.onended = () => { activityAudioRef.current = null; };
            audio.onerror = () => {
                console.error("Activity audio element error");
                setActivityAudioError("Error playing audio file."); // Use renamed state variable
                activityAudioRef.current = null;
            };
        } else {
            throw new Error("Backend did not return audio content.");
        }
    } catch (e) {
        console.error("Activity TTS Fetch Error:", e);
        setActivityAudioError(`Failed to get audio: ${(e as Error).message}`); // Use renamed state variable
    } finally {
        setIsActivityAudioLoading(false); // Use renamed state variable
    }
  }, [isActivityAudioLoading, authenticatedFetch, setIsActivityAudioLoading, setActivityAudioError, setError, summaryAudioRef, setIsSummaryPlaying]);

  // --- REPLACE the entire useEffect from ~line 1782 to 1823 ---
  // Effect to create Audio object when src changes
  useEffect(() => {
    // --- DEBUG LOG ---
    console.log(`[AUDIO_DEBUG] 4. useEffect[summaryAudioSrc]: RUNNING. summaryAudioSrc exists: ${!!summaryAudioSrc}, summaryAudioRef.current exists: ${!!summaryAudioRef.current}`);
    // ---

    if (summaryAudioSrc && !summaryAudioRef.current) {
      console.log("[AUDIO_DEBUG] 5. useEffect: Creating new Audio() object.");
      const audio = new Audio(summaryAudioSrc);
      summaryAudioRef.current = audio;

      const setAudioData = (eventName: string) => {
        if (summaryAudioRef.current) {
          const duration = summaryAudioRef.current.duration;
          const readyState = summaryAudioRef.current.readyState;
          
          // --- DEBUG LOG ---
          console.log(`[AUDIO_DEBUG] 7. setAudioData (from ${eventName}): CALLED. Duration: ${duration}, ReadyState: ${readyState}`);
          // ---
          
          // ONLY set duration if it's a real, finite number
          if (duration && isFinite(duration) && duration > 0) {
            console.log(`[AUDIO_DEBUG] 8. setAudioData: Duration is VALID. Calling setSummaryAudioDuration(${duration}).`);
            setSummaryAudioDuration(duration); // <-- THIS IS THE GOAL
            setSummaryAudioProgress(summaryAudioRef.current.currentTime);
          } else {
            console.log(`[AUDIO_DEBUG] 8a. setAudioData: Duration is NOT valid yet (${duration}).`);
          }
        } else {
          console.log(`[AUDIO_DEBUG] 7a. setAudioData (from ${eventName}): CALLED, but summaryAudioRef.current is NULL.`);
        }
      };

      const setAudioTime = () => {
        // console.log("[AUDIO_DEBUG] setAudioTime: timeupdate fired."); // <-- Too noisy
        if (summaryAudioRef.current) {
          setSummaryAudioProgress(summaryAudioRef.current.currentTime);
        }
      };

      const setAudioEnd = () => {
        console.log("[AUDIO_DEBUG] setAudioEnd: 'ended' event fired.");
        setIsSummaryPlaying(false);
        setSummaryAudioProgress(0); // Reset progress on end
      };

      // --- DEBUG LOG for attaching listeners ---
      console.log("[AUDIO_DEBUG] 6. useEffect: Attaching event listeners...");
      // ---
      
      audio.addEventListener("loadedmetadata", () => setAudioData("loadedmetadata"));
      audio.addEventListener("durationchange", () => setAudioData("durationchange"));
      audio.addEventListener("canplay", () => setAudioData("canplay"));
      audio.addEventListener("timeupdate", setAudioTime);
      audio.addEventListener("ended", setAudioEnd);
      audio.addEventListener("error", (e) => {
        console.error("[AUDIO_DEBUG] 9. Audio Element Error:", e);
        setSummaryAudioError("Audio element reported an error.");
      });

      // --- DEBUG LOG for manual check ---
      const initialReadyState = audio.readyState;
      console.log(`[AUDIO_DEBUG] 6a. useEffect: Manual readyState check: ${initialReadyState}`);
      // ---
      
      if (initialReadyState >= 1) { // HAVE_METADATA
        console.log("[AUDIO_DEBUG] 6b. useEffect: Manually firing setAudioData (readyState >= 1).");
        setAudioData("manual-check");
      }
      
      // Cleanup
      return () => {
        console.log("[AUDIO_DEBUG] 10. useEffect: CLEANUP running.");
        audio.removeEventListener("loadedmetadata", () => setAudioData("loadedmetadata"));
        audio.removeEventListener("durationchange", () => setAudioData("durationchange"));
        audio.removeEventListener("canplay", () => setAudioData("canplay"));
        audio.removeEventListener("timeupdate", setAudioTime);
        audio.removeEventListener("ended", setAudioEnd);
        audio.removeEventListener("error", (e) => console.error("[AUDIO_DEBUG] 9. Audio Element Error:", e));
        audio.pause(); 
        summaryAudioRef.current = null; 
      };
    } else if (!summaryAudioSrc && summaryAudioRef.current) {
        console.log("[AUDIO_DEBUG] 4a. useEffect: summaryAudioSrc is now null. Cleaning up old ref.");
        summaryAudioRef.current.pause();
        summaryAudioRef.current = null;
    } else {
        console.log("[AUDIO_DEBUG] 4b. useEffect: Ran but no action taken (e.g., src already exists AND ref exists).");
    }
  }, [summaryAudioSrc]); // Re-run only when src changes

  const toggleSummaryPlayPause = useCallback(() => {
    if (summaryAudioRef.current) {
      if (isSummaryPlaying) {
        summaryAudioRef.current.pause();
      } else {
        // --- Pause ACTIVITY audio if it's playing ---
        if (activityAudioRef.current) {
            activityAudioRef.current.pause();
            // Optionally update activity audio state if needed, though pausing is the main goal
        }
        // --- End Pause ACTIVITY audio ---
        summaryAudioRef.current.play().catch(e => {
            console.error("Summary audio play error:", e);
            setSummaryAudioError("Could not play audio.");
        });

      }
      setIsSummaryPlaying(!isSummaryPlaying);
    } else if (currentLesson?.summary && !isSummaryAudioLoading) {
        // If audio not loaded yet, fetch it and then play (will happen via useEffect)
        // --- FIX 5: Pass targetLanguage ---
        fetchSummaryAudio(currentLesson.summary, targetLanguage);
    }
  }, [isSummaryPlaying, currentLesson, isSummaryAudioLoading, fetchSummaryAudio, targetLanguage, setIsSummaryPlaying, setSummaryAudioError]);

  const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (summaryAudioRef.current) {
      const time = Number(event.target.value);
      summaryAudioRef.current.currentTime = time;
      setSummaryAudioProgress(time);
    }
  }, []);

  // Helper to format time (MM:SS)
  const formatTime = useCallback((timeInSeconds: number): string => {
    if (isNaN(timeInSeconds) || timeInSeconds < 0) return "00:00";
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  // --- Render Functions ---

  // --- NEW: Standalone LandingPage Component ---
// Place this component outside (e.g., before) your main App component
const LandingPage: React.FC<{
  signInWithGoogle: () => void;
  isApiLoading: boolean;
  error: string | null;
  uiLanguage: LanguageCode;
  setUiLanguage: (lang: LanguageCode) => void;
  navigate: (path: string) => void;
  t: (key: string) => string;
  languageCodes: LanguageCode[];
}> = ({ signInWithGoogle, isApiLoading, error, uiLanguage, setUiLanguage, navigate, t, languageCodes }) => {
  const [activeModal, setActiveModal] = useState<string | null>(null);

   // --- NEW: Reusable Modal Component with Enhanced Styling ---
    const Modal = ({ id, title, children, bgImage }: { id: string, title: string, children: React.ReactNode, bgImage: string }) => {
      if (activeModal !== id) return null;

      return (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-center items-center p-4 transition-opacity duration-300"
          onClick={() => setActiveModal(null)} // Close on overlay click
        >
          {/* Outer container for borders and background image */}
          <div 
            className="bg-cover bg-center w-full max-w-2xl rounded-xl shadow-2xl border-4 border-slate-300 ring-4 ring-slate-500"
            style={{ backgroundImage: `url(${bgImage})` }}
            onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside modal
          >
            {/* Inner container for content and dark overlay */}
            <div className="relative bg-gray-900/60 text-slate-100 rounded-md p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
              
              {/* Close Button */}
              <button 
                onClick={() => setActiveModal(null)}
                className="absolute top-4 right-4 text-slate-300 hover:text-white transition"
                aria-label="Close modal"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              
              <h2 
                className="text-2xl sm:text-3xl font-bold mb-4" 
                style={{ textShadow: '2px 2px 4px rgba(0, 0, 0, 0.7)' }} // Phat text shadow
              >
                {title}
              </h2>
              
              {/* Prose Invert styles all child text for dark BGs */}
              <div 
                className="prose prose-invert max-w-none"
                style={{ textShadow: '1px 1px 3px rgba(0, 0, 0, 0.7)' }}
              >
                {children}
              </div>
            </div>
          </div>
        </div>
      );
    };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-slate-900 text-slate-200 p-4">
      <div className="max-w-4xl w-full bg-white rounded-xl shadow-2xl p-6 sm:p-10 space-y-8">
        <div className="text-center space-y-4">
          <img src="/banner.png" alt="StreamLearn Logo" className="h-12 sm:h-16 mx-auto mb-2" />
          <h1 className="text-3xl sm:text-5xl font-bold text-gray-900">
            {t('common.appTitle').replace("StreamLearn: ", "")}
          </h1>
          <p className="text-lg text-gray-700 max-w-2xl mx-auto">
            {t('common.appDescription')}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { id: 'features', img: '/landing1.png', title: 'Features' },
            { id: 'howitworks', img: '/landing2.png', title: 'How It Works' },
            { id: 'usecases', img: '/landing3.png', title: 'Use Cases' },
            { id: 'languages', img: '/landing4.png', title: 'Languages' },
            { id: 'pricing', img: '/landing5.png', title: 'Pricing' },
          ].map((item) => (
            <button 
              key={item.id} 
              onClick={() => setActiveModal(item.id)}
              className="aspect-video bg-gray-200 rounded-lg shadow-md overflow-hidden group focus:outline-none focus:ring-4 focus:ring-blue-400 focus:ring-opacity-75"
              title={`Learn more about ${item.title}`}
            >
              <img src={item.img} alt={`Showcase of ${item.title}`} className="object-cover w-full h-full transition-transform duration-300 group-hover:scale-110" />
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6 border-t border-gray-200">
          <div className="w-full sm:w-auto flex-grow-0">
             <p className="text-sm text-gray-600 mb-2">{t('signIn.prompt')}</p>
             <button
                onClick={signInWithGoogle}
                disabled={isApiLoading}
                className="w-full bg-blue-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-blue-700 transition duration-150 shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
             >
                <svg className="w-5 h-5" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path><path fill="none" d="M0 0h48v48H0z"></path></svg>
                {t('signIn.button')}
             </button>
             {error && <ErrorMessage message={error} />}
          </div>

          <div className="w-full sm:w-1/3 sm:ml-4 flex-shrink-0">
             <label htmlFor="lang-select-landing" className="text-sm text-gray-600 mb-2 block">{t('dashboard.uiLang')}</label>
             <select
                id="lang-select-landing"
                value={uiLanguage}
                onChange={(e) => {
                  const newLang = e.target.value as LanguageCode;
                  setUiLanguage(newLang);
                  const params = new URLSearchParams(window.location.search);
                  params.set('lang', newLang);
                  window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
                }}
                className="w-full p-3 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
              >
                {languageCodes.map((code) => (
                  <option key={code} value={code}>{t(`languages.${code}`)}</option>
                ))}
              </select>
          </div>
        </div>
        
        <div className="text-center text-sm text-gray-400 space-x-4 pt-4">
          <a href="/terms" onClick={(e) => { e.preventDefault(); navigate('/terms'); }} className="hover:underline">{t('dashboard.tos')}</a>
          <span>&bull;</span>
          <a href="/privacy" onClick={(e) => { e.preventDefault(); navigate('/privacy'); }} className="hover:underline">{t('dashboard.privacy')}</a>
        </div>

        {/* --- MODIFIED: Pass bgImage prop to each modal --- */}
        <Modal id="features" title={t('landing.modalFeaturesTitle')} bgImage="/landing1.png">
            <h4>{t('landing.modalFeaturesH4_1')}</h4>
            <p>{t('landing.modalFeaturesP_1')}</p>
            <h4>{t('landing.modalFeaturesH4_2')}</h4>
            <p>{t('landing.modalFeaturesP_2')}</p>
        </Modal>
        
        <Modal id="howitworks" title={t('landing.modalHowTitle')} bgImage="/landing2.png">
            <ol>
                <li dangerouslySetInnerHTML={{ __html: t('landing.modalHowOl_1') }} />
                <li dangerouslySetInnerHTML={{ __html: t('landing.modalHowOl_2') }} />
                <li dangerouslySetInnerHTML={{ __html: t('landing.modalHowOl_3') }} />
            </ol>
        </Modal>

        <Modal id="usecases" title={t('landing.modalUseCasesTitle')} bgImage="/landing3.png">
            <h4>{t('landing.modalUseCasesH4_1')}</h4>
            <p>{t('landing.modalUseCasesP_1')}</p>
            <h4>{t('landing.modalUseCasesH4_2')}</h4>
            <p>{t('landing.modalUseCasesP_2')}</p>
        </Modal>

        <Modal id="languages" title={t('landing.modalLanguagesTitle')} bgImage="/landing4.png">
            <p>{t('landing.modalLanguagesP_1')}</p>
            <ul className="grid grid-cols-2 gap-x-4">
              {languageCodes.map(code => <li key={code}>{t(`languages.${code}`)}</li>)}
            </ul>
        </Modal>

         <Modal id="pricing" title={t('landing.modalPricingTitle')} bgImage="/landing5.png">
            <h4>{t('landing.modalPricingH4_1')}</h4>
            <p dangerouslySetInnerHTML={{ __html: t('landing.modalPricingP_1', { count: FREE_LESSON_LIMIT }) }} />
            <h4>{t('landing.modalPricingH4_2')}</h4>
            <p dangerouslySetInnerHTML={{ __html: t('landing.modalPricingP_2') }} />
        </Modal>

      </div>
    </div>
  );
};

// --- ADDITION: New function to start word bank practice ---
  // --- FIX: Moved this function BEFORE renderDashboard ---
  const startWordBankActivity = (mode: 'wordbank_study' | 'wordbank_review') => {
    // Use the memoized list of words for practice
    if (!wordsForPractice || wordsForPractice.length < 1) { 
      const errorMsg = wordBankLanguageFilter === 'all'
        ? t('wordBank.practiceEmpty')
        // Provide a more specific error message if a filter is active
        : `You need to save at least 1 word for ${t(`languages.${wordBankLanguageFilter}`)} to practice.`;
      setError(errorMsg);
      return;
    }
    
    activityCancellationRef.current = false;
    setError(null);
    const totalItems = wordsForPractice.length;
    
    // Create and shuffle indices
    const indices = Array.from(Array(totalItems).keys()); // [0, 1, 2, ..., total-1]
    const shuffledIndices = shuffleArray(indices); // Shuffle the indices
    console.log("Shuffled Word Bank indices:", shuffledIndices);

    setActivityState({
      type: mode,
      index: 0,
      score: 0, // Score is 0 for review mode
      total: totalItems,
      shuffledIndices: shuffledIndices,
      currentData: null, // Will be loaded by useEffect
      userAnswer: null,
      feedback: { isCorrect: null, message: '' },
      isSubmitting: false,
    });
    setCurrentView('ACTIVITY');
  };

  // --- MODIFY THIS FUNCTION ---
  const startStandaloneActivity = useCallback((type: PracticeTopicType, topic: PracticeTopic) => {
    if (!user) {
      setError("Please sign in to start practice.");
      return;
    }

    console.log(`Starting standalone activity: ${type} - ${topic.title}`);
    activityCancellationRef.current = false;
    setError(null);

    // Standalone activities are always 1 question at a time (infinite total)
    const totalItems = Infinity;

    setActivityState({
      // --- FIX: Use the new PracticeTopicType ---
      type: `${type}_standalone` as ActivityType, // e.g., 'grammar_standalone'
      index: 0,
      score: 0,
      total: totalItems,
      shuffledIndices: undefined,
      currentData: null, // Will be loaded by useEffect
      userAnswer: null,
      feedback: { isCorrect: null, message: '' },
      isSubmitting: true, // Start in loading state
      
      // --- ADD THIS ---
      // Pass the selected topic into the activity state
      // We will read this in the useEffect hook
      practiceTopic: topic 
      // --- END ADDITION ---
    });
    setCurrentView('ACTIVITY');
  }, [user, setError, setActivityState, setCurrentView]);

  const renderDashboard = () => (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto bg-white rounded-xl shadow-2xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-2 border-b pb-3">
        <img src="/banner.png" alt="StreamLearn Banner Logo" className="h-8 sm:h-10" />
        {isSubscribed && (
            <span className="text-sm font-bold text-yellow-600 bg-yellow-100 px-2 py-0.5 rounded-full border border-yellow-500 shadow-sm">
              MAX
            </span>
          )}
        {user && (
          <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1 flex-shrink-0"
          >
            {t('signIn.signOutUser', { user: user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'User' })}
          </button>
        )}
      </div>

      {/* Quick Actions */}
      {/* --- START: Updated Quick Actions --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          onClick={goToInput}
          className="flex items-center justify-between w-full font-bold py-3 px-4 rounded-lg text-white
                     bg-gradient-to-b from-blue-500 to-blue-700
                     shadow-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]
                     transition-all duration-150
                     hover:from-blue-600 hover:to-blue-700
                     active:shadow-inner active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] active:translate-y-px"
        >
          <span>{t('dashboard.startLesson')}</span>
          <RestartIcon className="w-5 h-5" /> 
        </button>
        <button
          onClick={() => navigate('/wordbank')}
          disabled={isWordBankLoading}
          className="flex items-center justify-between w-full font-bold py-3 px-4 rounded-lg text-white
                     bg-gradient-to-b from-green-500 to-green-700
                     shadow-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]
                     transition-all duration-150
                     hover:from-green-600 hover:to-green-700
                     active:shadow-inner active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] active:translate-y-px"
        >
          {t('dashboard.wordBank', { count: wordBank.length })}
          <BookOpenIcon className="w-5 h-5" />
        </button>

        {/* Subscription Button */}
        {isBillingLoading ? (
            <button disabled 
              className="flex items-center justify-between w-full font-bold py-3 px-4 rounded-lg text-white
                     bg-gradient-to-b from-indigo-500 to-indigo-700
                     shadow-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]
                     transition-all duration-150
                     hover:from-indigo-600 hover:to-indigo-700
                     active:shadow-inner active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] active:translate-y-px"
            >
              <LoadingSpinner className="w-5 h-5" /> {t('common.loading')}
            </button>
        ) : isSubscribed ? (
            <button
              onClick={handleManageBilling}
              className="flex items-center justify-between w-full font-bold py-3 px-4 rounded-lg text-white
                     bg-gradient-to-b from-indigo-500 to-indigo-700
                     shadow-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]
                     transition-all duration-150
                     hover:from-indigo-600 hover:to-indigo-700
                     active:shadow-inner active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] active:translate-y-px"
            >
             {t('dashboard.manageBilling')} <CreditCardIcon className="w-5 h-5" />
            </button>
        ) : (
            <button
              onClick={() => navigate('/pricing')}
              className="flex items-center justify-between w-full font-bold py-3 px-4 rounded-lg text-white
                     bg-gradient-to-b from-indigo-500 to-indigo-700
                     shadow-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]
                     transition-all duration-150
                     hover:from-indigo-600 hover:to-indigo-700
                     active:shadow-inner active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] active:translate-y-px"
            >
              {t('dashboard.upgradePro')} <CreditCardIcon className="w-5 h-5" />
            </button>
        )}
      </div>
      {/* --- END: Updated Quick Actions --- */}
      
      {/* Footer for TOS/Privacy */}
      <div className="text-center text-xs text-gray-400 space-x-4 pt-2">
        <a href="/terms" onClick={(e) => { e.preventDefault(); navigate('/terms'); }} className="hover:underline">{t('dashboard.tos')}</a>
        <span>&bull;</span>
        <a href="/privacy" onClick={(e) => { e.preventDefault(); navigate('/privacy'); }} className="hover:underline">{t('dashboard.privacy')}</a>
      </div>

       {/* --- NEW: Language Settings --- */}
      <div className="space-y-3 border-t pt-4">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 flex items-center gap-2">
          <LanguageIcon className="w-6 h-6" /> Language Settings
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              My UI Language (What I see)
            </label>
            <select
              value={uiLanguage}
              onChange={(e) => setUiLanguage(e.target.value as LanguageCode)}
              className="w-full p-3 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              {languageCodes.map((code) => (
                <option key={code} value={code}>{t(`languages.${code}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              My Target Language (What I want to learn)
            </label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value as LanguageCode)}
              className="w-full p-3 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              {languageCodes.map((code) => (
                <option key={code} value={code}>{t(`languages.${code}`)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* --- MODIFY Practice Center SECTION --- */}
      <div className="space-y-3 border-t pt-4">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 flex items-center gap-2">
          <BeakerIcon className="w-6 h-6" /> {t('dashboard.practiceCenter')}
        </h2>
        <p className="text-sm text-gray-500">
          {t('dashboard.practiceDescription')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={() => setIsPracticeCenterOpen(true)} // --- FIX: Open modal ---
            disabled={isApiLoading || activityState?.isSubmitting}
            className="flex items-center justify-between w-full font-bold py-3 px-4 rounded-lg text-white
                     bg-gradient-to-b from-emerald-500 to-emerald-700
                     shadow-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]
                     transition-all duration-150
                     hover:from-emerald-600 hover:to-emerald-700
                     active:shadow-inner active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] active:translate-y-px"
          >
            {t('dashboard.grammarPractice')} <PencilSquareIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsPracticeCenterOpen(true)} // --- FIX: Open modal ---
            disabled={isApiLoading || activityState?.isSubmitting}
            className="flex items-center justify-between w-full font-bold py-3 px-4 rounded-lg text-white
                     bg-gradient-to-b from-teal-500 to-teal-700
                     shadow-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]
                     transition-all duration-150
                     hover:from-blue-teal hover:to-blue-teal
                     active:shadow-inner active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] active:translate-y-px"
          >
            {t('dashboard.writingPractice')} <BrainIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Lesson History */}
      <div className="space-y-3">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 border-t pt-4">{t('dashboard.historyTitle')}</h2>

        <div className="relative">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <SearchIcon className="w-5 h-5 text-gray-400" />
          </div>
          <input
            type="text"
            value={dashboardSearchTerm}
            onChange={(e) => setDashboardSearchTerm(e.target.value)}
            placeholder={t('dashboard.historySearch')}
            className="w-full p-3 pl-10 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {isHistoryLoading ? (
          <LoadingSpinner text={t('dashboard.historyLoading')} />
        ) : lessonHistory.length === 0 ? (
          <p className="text-center text-gray-500 py-4">{t('dashboard.historyEmpty')}</p>
        ) : (
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
            {filteredLessonHistory.length === 0 && dashboardSearchTerm.trim() !== '' ? (
              <p className="text-center text-gray-500 py-4">{t('dashboard.historyNoResults', { term: dashboardSearchTerm })}</p>
            ) : (
              filteredLessonHistory.map((lesson) => (
              <button
                key={lesson.id}
                onClick={() => handleSelectPastLesson(lesson)}
                className="w-full flex gap-3 items-center p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-blue-50 transition duration-150 text-left"
              >
                {lesson.image ? (
                  <div className="relative flex-shrink-0">
                    <img
                      src={lesson.image}
                      alt=""
                      className="w-16 h-16 object-cover rounded"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                    {/* --- ADD THIS CHECKMARK --- */}
                    {lesson.guidedCompleted && (
                      <CheckCircleIcon 
                        className="w-6 h-6 text-green-500 absolute -top-2 -right-2 bg-white rounded-full" 
                        title="Guided lesson completed" 
                      />
                    )}
                  </div>
                ) : (
                  <div className="w-16 h-16 flex items-center justify-center bg-gray-100 rounded flex-shrink-0 relative">
                    {/* --- AND ADD IT HERE --- */}
                    {lesson.guidedCompleted && (
                      <CheckCircleIcon 
                        className="w-6 h-6 text-green-500 absolute -top-2 -right-2 bg-white rounded-full" 
                        title="Guided lesson completed" 
                      />
                    )}
                    <HistoryIcon className="w-8 h-8 text-blue-400" />
                  </div>
                )}
                <div className="flex-grow min-w-0">
                  <p className="text-lg font-semibold text-gray-900 line-clamp-2">
                    {lesson.lessonData.articleTitle}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    {t('dashboard.topic')} <span className="font-medium text-gray-800">{lesson.topic}</span>
                    <span className="mx-2">|</span>
                    {t('common.level')} <span className="font-medium text-gray-800">{t(`common.${lesson.level.toLowerCase()}`)}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {t('common.source')}: {lesson.source} ({lesson.date})
                  </p>
                </div>
                <ArrowLeftIcon className="w-5 h-5 text-gray-400 transform rotate-180 flex-shrink-0" />
              </button>
            ))
            )}
          </div>
        )}
      </div>
    </div>
  );

  // --- NEW: Function to render the new Guided Lesson view ---
   const renderGuidedLesson = () => {
     if (!currentLesson) return <LoadingSpinner />;
 
     return (
       <div className="p-4 sm:p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-2xl space-y-6">
         {/* Header with Toggle Button */}
         <div className="flex flex-wrap justify-between items-center gap-2 border-b pb-3 mb-3">
           <button onClick={() => navigate('/')} title={t('dashboard.title')}>
             <img src="/banner.png" alt="StreamLearn Banner Logo" className="h-8 sm:h-10" />
           </button>
           <button
             onClick={() => setLessonViewMode('overview')}
             className="flex items-center justify-between w-full font-bold py-3 px-4 rounded-lg text-white
                     bg-gradient-to-b from-blue-500 to-blue-700
                     shadow-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]
                     transition-all duration-150
                     hover:from-blue-600 hover:to-blue-700
                     active:shadow-inner active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] active:translate-y-px"
             title={t('lesson.switchToOverview')}
           >
             <span>{t('lesson.overviewMode')}</span>
             <ArrowsRightLeftIcon className="w-5 h-5" />
           </button>
         </div>
 
         {/* Article Title */}
         <h2 className="text-2xl sm:text-3xl font-bold text-blue-700 text-center -mt-4">
           {currentLesson.articleTitle}
         </h2>
 
         {/* Guided Flow Component */}
         <GuidedLessonFlow
           lesson={currentLesson}
           activityState={activityState}
           currentStep={guidedLessonStep}
           setStep={setGuidedLessonStep}
           startActivity={startActivity}
           onSpeak={handleActivityTextToSpeech}
           isAudioLoading={isActivityAudioLoading}
           onAnswerChange={(answer) => setActivityState(prev => prev ? { ...prev, userAnswer: answer } : null)}
           onSubmitAnswer={handleSubmitAnswer}
           onNextQuestion={handleNextActivityQuestion} // Pass the "next question" handler
           onFinish={quitActivity} // Pass the "quit" handler
           uiLanguage={uiLanguage}
           // --- FIX: Pass targetLanguage and wordBank props ---
           targetLanguage={targetLanguage}
           wordBank={wordBank}
           handleSaveWord={handleSaveWord}
           // --- NEW: Pass Grammar Example props ---
           generatedGrammarExamples={generatedGrammarExamples}
           isGeneratingExample={isGeneratingExample}
           handleGenerateGrammarExample={handleGenerateGrammarExample}
           // --- NEW: Pass Comprehension Answer props ---
           comprehensionAnswers={comprehensionAnswers}
           isAnswerLoading={isAnswerLoading}
           handleFetchComprehensionAnswer={handleFetchComprehensionAnswer}
           // --- Pass Summary Audio Player state and handlers ---
           summaryAudioSrc={summaryAudioSrc}
           summaryAudioDuration={summaryAudioDuration}
           summaryAudioProgress={summaryAudioProgress}
           isSummaryPlaying={isSummaryPlaying}
           isSummaryAudioLoading={isSummaryAudioLoading}
           summaryAudioError={summaryAudioError}
           toggleSummaryPlayPause={toggleSummaryPlayPause}
           handleSeek={handleSeek}
           formatTime={formatTime}
         />
 
         {/* Chat Assistant (still available in guided mode) */}
         <ChatAssistant
           lesson={currentLesson}
           uiLanguage={uiLanguage}
           targetLanguage={targetLanguage}
           history={chatHistory}
           isLoading={isChatLoading}
           error={chatError}
           onSubmit={handleChatSubmit}
           onClearChat={handleClearChat}
           isSubscribed={isSubscribed}
           liveChatUsageCount={liveChatUsageCount}
           isUsageLoading={isUsageLoading}
           onIncrementLiveChatUsage={handleIncrementLiveChatUsage}
           geminiApiKey={import.meta.env.VITE_GEMINI_API_KEY}
         />
       </div>
     );
  };

  const renderWordBank = () => (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto bg-white rounded-xl shadow-2xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-2 border-b pb-3">
        {/* Back button */}
        <button
            onClick={() => {
              // --- ADD AUDIO STOP ---
              if (activityAudioRef.current) {
                  activityAudioRef.current.pause();
                  activityAudioRef.current = null;
              }
              // --- END ADD ---
              navigate('/');
            }}
            className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
            title={t('dashboard.title')}
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" /> {t('dashboard.title')}
        </button>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">{t('wordBank.title')}</h2>
        {user && (
          <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1 flex-shrink-0"
          >
            {t('common.signOut')}
          </button>
        )}
      </div>

      {/* Temporary Message */}
      {wordBankMessage && (
        <div className={`p-2 text-sm text-center rounded ${wordBankMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {t(wordBankMessage.text)}
        </div>
      )}

      {/* --- ADDITION: Practice Flashcards Section --- */}
      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800 flex items-center gap-2">
            <BrainIcon className="w-6 h-6" /> {t('wordBank.practiceTitle')}
          </h2>
          {/* --- NEW: Language Filter Dropdown --- */}
          <select
            value={wordBankLanguageFilter}
            onChange={(e) => setWordBankLanguageFilter(e.target.value as LanguageCode | 'all')}
            disabled={wordBank.length === 0}
            className="w-full sm:w-auto p-2 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
          >
            <option value="all">All Languages ({wordBank.length})</option>
            {Object.keys(groupedWordBank).map((lang) => (
              <option key={lang} value={lang}>
                {t(`languages.${lang}`)} ({groupedWordBank[lang as LanguageCode].length})
              </option>
            ))}
          </select>
        </div>
        {/* --- FIX: Check wordsForPractice list --- */}
        {wordsForPractice.length < 1 ? ( // You can study with just 1 word
          <p className="text-sm text-center text-gray-500 p-2 bg-gray-50 rounded-lg">
            {wordBankLanguageFilter === 'all'
              ? t('wordBank.practiceEmpty').replace('2', '1') // Adjust count text if needed
              : `You need to save at least 1 word for ${t(`languages.${wordBankLanguageFilter}`)} to practice.`
            }
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => startWordBankActivity('wordbank_study')}
              className="flex items-center justify-between w-full font-bold py-3 px-4 rounded-lg text-white
                     bg-gradient-to-b from-cyan-500 to-cyan-700
                     shadow-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]
                     transition-all duration-150
                     hover:from-cyan-600 hover:to-cyan-700
                     active:shadow-inner active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] active:translate-y-px"            >
                {t('wordBank.studyFlashcards')} <PencilSquareIcon className="w-5 h-5" />
            </button>
            <button
              onClick={() => startWordBankActivity('wordbank_review')}
              className="flex items-center justify-between w-full font-bold py-3 px-4 rounded-lg text-white
                     bg-gradient-to-b from-sky-500 to-sky-700
                     shadow-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]
                     transition-all duration-150
                     hover:from-sky-600 hover:to-sky-700
                     active:shadow-inner active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] active:translate-y-px"            >
                 {t('wordBank.reviewFlashcards')} <BookOpenIcon className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* Word List */}
      <div className="space-y-3">
        {isWordBankLoading ? (
          <LoadingSpinner text={t('wordBank.loading')} />
        ) : wordBank.length === 0 ? (
          <p className="text-center text-gray-500 py-4">{t('wordBank.empty')}</p>
        ) : (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
           {Object.entries(groupedWordBank)
             // Optional: Sort languages so 'en' is first, then alphabetically
             .sort(([langA], [langB]) => {
               if (langA === 'en') return -1;
               if (langB === 'en') return 1;
               return langA.localeCompare(langB);
             })
             .map(([langCode, words]) => (
             <div key={langCode} className="space-y-3">
               <h3 className="text-lg font-semibold text-gray-700 border-b pb-1">
                 {t(`languages.${langCode}`)}
               </h3>
               {words.map((item) => (
                 <div
                   key={item.id}
                   className="flex gap-3 items-start p-4 border border-gray-200 rounded-lg"
                 >
                   <div className="flex-grow min-w-0">
                     <strong className="text-lg text-purple-800">{item.word}</strong>
                     <p className="text-gray-700">{item.definition}</p>
                     <p className="text-sm italic text-gray-500 mt-1">
                       {t('common.example')} "{item.articleExample}"
                       <SpeakButton text={item.articleExample} langCode={item.targetLanguage} />
                     </p>
                   </div>
                   <button
                     onClick={() => handleDeleteWord(item.word)}
                     title={t('common.deleteWord')}
                     className="p-1 text-gray-400 hover:text-red-600 flex-shrink-0"
                   >
                     {/* Simple 'X' icon for delete */}
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                       <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                     </svg>
                   </button>
                 </div>
               ))}
             </div>
           ))}
         </div>
        )}
      </div>
    </div>
  );

  // --- NEW: Reusable SpeakButton ---
  const SpeakButton = ({ text, langCode }: { text: string | undefined | null, langCode: LanguageCode }) => (
    <button
       onClick={() => {
           console.log(`SpeakButton clicked. Lang: ${langCode}, Text:`, text);
           // FIX: Pass langCode to the handler
           handleActivityTextToSpeech(text, langCode);
       }}
       disabled={isActivityAudioLoading || !text}
       className="ml-2 p-1 text-gray-500 hover:text-blue-600 disabled:opacity-50 inline-block align-middle cursor-pointer disabled:cursor-not-allowed"
       title={t('common.readAloud')}
     >
       {isActivityAudioLoading ? (
            <LoadingSpinner className="w-4 h-4 inline-block" />
       ) : (
            <VolumeUpIcon className="w-5 h-5" />
       )}
    </button>
  );

  const StaticPageWrapper: React.FC<{ titleKey: string, children: React.ReactNode }> = ({ titleKey, children }) => (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto bg-white rounded-xl shadow-2xl space-y-5">
      <div className="flex justify-between items-center gap-2 border-b pb-3">
        <button
            onClick={() => navigate('/')} // Back to Dashboard
            className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
            title={t('dashboard.title')}
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" /> {t('dashboard.title')}
        </button>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">{t(titleKey)}</h2>
        <div className="w-24"></div> {/* Spacer */}
      </div>
      <div className="prose prose-lg max-w-none text-gray-700">
        {children}
      </div>
    </div>
  );

  const renderPricingPage = () => (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-2xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-2 border-b pb-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
          title={t('dashboard.title')}
        >
          <ArrowLeftIcon className="w-4 h-4 mr-1" /> {t('dashboard.title')}
        </button>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center">
          {t('pricing.title')}
        </h1>
        {user ? (
          <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1 flex-shrink-0"
          >
            {t('common.signOut')}
          </button>
        ) : (
          <div className="w-24"></div> // Spacer to balance the header
        )}
      </div>
      
      <p className="text-lg text-gray-600 text-center">
        {t('pricing.description')}
      </p>

      {/* Pricing Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
        
        {/* Free Plan Card */}
        <div className="border border-gray-200 rounded-xl p-6 shadow-lg flex flex-col">
          <h2 className="text-2xl font-semibold text-gray-800">{t('pricing.freeTitle')}</h2>
          <p className="text-gray-500 mt-2">{t('pricing.freeDescription')}</p>
          
          <div className="my-6">
            <span className="text-4xl font-extrabold text-gray-900">$0</span>
            <span className="text-lg font-medium text-gray-500">/ {t('pricing.billing').split(' ')[1]}</span>
          </div>
          
          <ul className="space-y-3 mb-8">
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-green-500 flex-shrink-0" />
              <span className="text-gray-700" dangerouslySetInnerHTML={{ __html: t('pricing.freeFeature', { count: FREE_LESSON_LIMIT, interpolation: { escapeValue: false } }) }} />
            </li>
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-green-500 flex-shrink-0" />
              <span className="text-gray-700">{t('pricing.feature2').replace('Unlimited', 'Full access to all')}</span>
            </li>
          </ul>
          
          {/* Spacer to push button to bottom */}
          <div className="flex-grow"></div> 
          
          <button
            onClick={() => navigate('/')} // Just go back to dashboard
            className="w-full bg-white text-blue-600 border border-blue-600 font-bold py-3 px-6 rounded-lg hover:bg-blue-50 transition duration-150"
          >
            {t('pricing.currentPlan')}
          </button>
        </div>

        {/* Max Plan Card (Featured) */}
        <div className="border-2 border-blue-600 rounded-xl p-6 shadow-2xl relative flex flex-col bg-gray-50">
          {/* "Most Popular" Badge */}
          <div className="absolute top-0 -translate-y-1/2 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center px-4 py-1 rounded-full text-sm font-semibold text-white bg-blue-600 shadow-md">
              {t('pricing.mostPopular')}
            </span>
          </div>

          <h2 className="text-2xl font-semibold text-blue-700">{t('pricing.proTitle')}</h2>
          <p className="text-gray-500 mt-2">{t('pricing.description')}</p>
          
          <div className="my-6">
            <span className="text-4xl font-extrabold text-gray-900">{t('pricing.price')}</span>
            <span className="text-lg font-medium text-gray-500">/ {t('pricing.billing').split(' ')[1]}</span>
          </div>
          
          <p className="text-sm text-gray-500 -mt-2 text-center">{t('pricing.billing').split('.')[1]}.</p>
          
          <ul className="space-y-3 my-8">
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-blue-600 flex-shrink-0" />
              <span className="text-gray-700" dangerouslySetInnerHTML={{ __html: t('pricing.feature1') }} />
            </li>
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-blue-600 flex-shrink-0" />
              <span className="text-gray-700" dangerouslySetInnerHTML={{ __html: t('pricing.feature2') }} />
            </li>
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-blue-600 flex-shrink-0" />
              <span className="text-gray-700" dangerouslySetInnerHTML={{ __html: t('pricing.feature3') }} />
            </li>
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-blue-600 flex-shrink-0" />
              <span className="text-gray-700" dangerouslySetInnerHTML={{ __html: t('pricing.feature4') }} />
            </li>
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-blue-600 flex-shrink-0" />
              <span className="text-gray-700" dangerouslySetInnerHTML={{ __html: t('pricing.feature5') }} />
            </li>
          </ul>
          
          {/* Spacer */}
          <div className="flex-grow"></div>
          
          <button
            onClick={handleCheckout}
            disabled={isBillingLoading}
            className="w-full bg-blue-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-blue-700 transition duration-150 shadow-lg disabled:opacity-50"
          >
            {isBillingLoading ? (
              <LoadingSpinner className="w-5 h-5 inline-block" />
            ) : t('pricing.button')}
          </button>
        </div>
      </div>
    </div>
  );

  const renderTermsPage = () => (
    <StaticPageWrapper titleKey="tos.title">
      <>
        <p className="lead">{t('tos.lastUpdated')}</p>
        <p>{t('tos.p1')}</p>

        <h3>{t('tos.h1')}</h3>
        <p>{t('tos.p1')}</p>

        <h3>{t('tos.h2')}</h3>
        <p>{t('tos.p2_1')}</p>
        <p>{t('tos.p2_2')}</p>

        <h3>{t('tos.h3')}</h3>
        <p>{t('tos.p3')}</p>
        <ul>
          <li>{t('tos.p3_li1')}</li>
          <li>
            {t('tos.p3_li2').split('support@streamlearn.xyz')[0]}
            <a href="mailto:support@streamlearn.xyz">support@streamlearn.xyz</a>
            {t('tos.p3_li2').split('support@streamlearn.xyz')[1]}
          </li>
        </ul>

        <h3>{t('tos.h4')}</h3>
        <p dangerouslySetInnerHTML={{ __html: t('tos.p4_1') }} />
        <p dangerouslySetInnerHTML={{ __html: t('tos.p4_2') }} />
        <p dangerouslySetInnerHTML={{ __html: t('tos.p4_3') }} />
        
        <h3>{t('tos.h5')}</h3>
        <p dangerouslySetInnerHTML={{ __html: t('tos.p5') }} />

        <h3>{t('tos.h6')}</h3>
        <p>{t('tos.p6')}</p>

        <h3>{t('tos.h7')}</h3>
        <p>{t('tos.p7')}</p>

        <h3>{t('tos.h8')}</h3>
        <p>{t('tos.p8')}</p>

        <h3>{t('tos.h9')}</h3>
        <p>{t('tos.p9')}</p>

        <h3>{t('tos.h10')}</h3>
        <p>
          {t('tos.p10').split('support@streamlearn.xyz')[0]}
          <a href="mailto:support@streamlearn.xyz">support@streamlearn.xyz</a>
          {t('tos.p10').split('support@streamlearn.xyz')[1]}
        </p>
      </>
    </StaticPageWrapper>
  );

  const renderPrivacyPage = () => (
    <StaticPageWrapper titleKey="privacy.title">
      <>
        <p className="lead">{t('privacy.lastUpdated')}</p>
        <p>{t('privacy.p1')}</p>

        <h3>{t('privacy.h1')}</h3>
        <ul>
          <li dangerouslySetInnerHTML={{ __html: t('privacy.p1_li1') }} />
          <li dangerouslySetInnerHTML={{ __html: t('privacy.p1_li2') }} />
          <li dangerouslySetInnerHTML={{ __html: t('privacy.p1_li3') }} />
        </ul>

        <h3>{t('privacy.h2')}</h3>
        <p>{t('privacy.p2')}</p>
        <ul>
          <li>{t('privacy.p2_li1')}</li>
          <li>{t('privacy.p2_li2')}</li>
          <li>{t('privacy.p2_li3')}</li>
          <li>
            {t('privacy.p2_li4').split('support@streamlearn.xyz')[0]}
            <a href="mailto:support@streamlearn.xyz">support@streamlearn.xyz</a>
            {t('privacy.p2_li4').split('support@streamlearn.xyz')[1]}
          </li>
        </ul>

        <h3>{t('privacy.h3')}</h3>
        <p>{t('privacy.p3')}</p>
        <ul>
          <li dangerouslySetInnerHTML={{ __html: t('privacy.p3_li1') }} />
            <ul>
              <li dangerouslySetInnerHTML={{ __html: t('privacy.p3_li1_1') }} />
              <li dangerouslySetInnerHTML={{ __html: t('privacy.p3_li1_2') }} />
              <li dangerouslySetInnerHTML={{ __html: t('privacy.p3_li1_3') }} />
              <li dangerouslySetInnerHTML={{ __html: t('privacy.p3_li1_4') }} />
              <li dangerouslySetInnerHTML={{ __html: t('privacy.p3_li1_5') }} />
            </ul>
          <li dangerouslySetInnerHTML={{ __html: t('privacy.p3_li2') }} />
        </ul>

        <h3>{t('privacy.h4')}</h3>
        <p>{t('privacy.p4')}</p>
        
        <h3>{t('privacy.h5')}</h3>
        <p>
          {t('privacy.p5').split('support@streamlearn.xyz')[0]}
          <a href="mailto:support@streamlearn.xyz">support@streamlearn.xyz</a>
          {t('privacy.p5').split('support@streamlearn.xyz')[1]}
        </p>

        <h3>{t('privacy.h6')}</h3>
        <p>{t('privacy.p6')}</p>

        <h3>{t('privacy.h7')}</h3>
        <p>{t('privacy.p7')}</p>

        <h3>{t('privacy.h8')}</h3>
        <p>
          {t('privacy.p8').split('support@streamlearn.xyz')[0]}
          <a href="mailto:support@streamlearn.xyz">support@streamlearn.xyz</a>
          {t('privacy.p8').split('support@streamlearn.xyz')[1]}
        </p>
      </>
    </StaticPageWrapper>
  );

  const renderInput = () => {
    const isFreeTierLimitReached = !isSubscribed && monthlyLessonCount >= FREE_LESSON_LIMIT;
    const shortUser = user?.displayName?.split(' ')[0] || user?.email?.split('@')[0] || 'User';

    return (
      // Add padding-x for mobile screens to prevent elements touching edges
      <div className="p-4 sm:p-6 max-w-lg mx-auto bg-white rounded-xl shadow-2xl space-y-6">
        {/* Use flex-wrap and justify-between for better mobile header layout */}
        <div className="flex flex-wrap justify-between items-center gap-2">
          <button
              onClick={() => navigate('/')} // <-- Takes user back to dashboard
              className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
              title={t('dashboard.title')}
            >
              <ArrowLeftIcon className="w-4 h-4 mr-1" /> {t('dashboard.title')}
          </button>
          {user && (
            <button
              onClick={handleSignOut}
              // Adjusted padding and margin for better fit
              className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1 flex-shrink-0"
            >
              {t('signIn.signOutUser', { user: shortUser })}
            </button>
          )}
        </div>
         <p className="text-gray-500 text-center">
           {t('input.prompt')}
         </p>
        {isFreeTierLimitReached && (
          <div className="p-3 bg-yellow-100 border border-yellow-300 text-yellow-800 rounded-lg text-sm text-center">
            {t('input.freeLimit', { count: FREE_LESSON_LIMIT })}{' '}
            <button onClick={() => navigate('/pricing')} className="font-bold underline ml-1 hover:text-yellow-900">
              {t('input.upgrade')}
            </button> {t('input.toSearch')}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('input.levelLabel', { language: t(`languages.${targetLanguage}`) })}
          </label>
          <select
            value={inputLevel}
            onChange={(e) => setInputLevel(e.target.value as EnglishLevel)}
            className="w-full p-3 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
          >
            {[
              { key: 'common.beginner', value: 'Beginner' },
              { key: 'common.intermediate', value: 'Intermediate' },
              { key: 'common.advanced', value: 'Advanced' }
            ].map(level => (
              <option key={level.value} value={level.value}>{t(level.key)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="topic" className="block text-sm font-medium text-gray-700 mb-2">
            {t('input.topicLabel')}
          </label>
          {/* Use flex-wrap for the input and button on small screens */}
          <div className="flex flex-wrap sm:flex-nowrap gap-2">
            <input
              id="topic"
              type="text"
              value={inputTopic}
              onChange={(e) => setInputTopic(e.target.value.slice(0, 25))}
              placeholder={t('input.topicPlaceholder')}
              maxLength={25}
              className="flex-grow p-3 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 w-full sm:w-auto" // Ensure input takes full width on small screens
              onKeyDown={(e) => { if (e.key === 'Enter') handleFindArticles() }}
            />
            <button
              onClick={() => handleFindArticles()}
              disabled={isApiLoading || !inputTopic.trim() || isFreeTierLimitReached}
              // Make button full width on small screens, adjust padding
              className="bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition duration-150 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto flex-shrink-0"
              title={isFreeTierLimitReached ? t('input.limitReachedTitle') : t('input.findArticlesTitle')}
            >
              {t('input.search')}
            </button>
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700 mb-3 text-center">{t('input.popularTopics')}</p>
          {/* --- CHANGE HERE: grid-cols-2 by default, md:grid-cols-4 for medium and up --- */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {newsTopics.map((topic) => {
              // 1. Get the translation key
              const topicKey = `topics.${topic.toLowerCase().replace(/ /g, '_')}`;
              
              // 2. Get the topic name in the UI language (for display)
              const uiLanguageTopic = t(topicKey);
  
              // 3. Get the topic name in the TARGET language (for the search action)
              const targetLanguageTopic = t(topicKey, { lng: targetLanguage });

              return (
                <button
                  key={topic}
                  onClick={() => {
                    // 4. Set the input field to the target language topic
                    setInputTopic(targetLanguageTopic);
                   // 5. Search for the target language topic
                    handleFindArticles(targetLanguageTopic, false);
                  }}
                  disabled={isApiLoading || isFreeTierLimitReached}
                  className="bg-gray-100 text-gray-700 text-sm font-medium py-2 px-1 rounded-lg hover:bg-blue-100 hover:text-blue-700 transition duration-150 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed text-center truncate"
                  // 6. The title attribute describes the action (searching in target language)
                  title={isFreeTierLimitReached ? t('input.limitReachedTitle') : t('input.findTopicTitle', { topic: targetLanguageTopic })}
                >
                  {/* 7. Display the UI language topic */}
                  {uiLanguageTopic}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const renderNewsList = () => (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto bg-white rounded-xl shadow-2xl space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-2 border-b pb-3 mb-3">
        {/* Banner on the left */}
        <button onClick={() => navigate('/')} title={t('dashboard.title')}>
          <img src="/banner.png" alt="StreamLearn Banner Logo" className="h-8 sm:h-10" />
        </button>
        {isSubscribed && (
          <span className="text-xs font-bold bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded-full shadow-md -ml-2">
            {t('common.proBadge')}
          </span>
        )}
        {/* Sign out button on the right */}
        <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1 flex-shrink-0"
          >
            {t('common.signOut')}
        </button>
        {/* Back button and Title on a new line, spanning full width */}
        <div className="w-full flex justify-between items-center mt-2 gap-2">
            <button
              onClick={goToInput}
              className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium flex-shrink-0"
              title={t('news.changeTopicTitle')}
            >
              <ArrowLeftIcon className="w-4 h-4 mr-1" /> {t('common.back')}
            </button>
            {/* Title - allow wrapping */}
            <h2 className="text-lg sm:text-xl font-bold text-gray-800 text-center flex-grow min-w-0 break-words px-2"> {/* Added break-words and padding */}
              {t('news.title', { 
                topic: inputTopic, 
                level: t(inputLevel === 'Beginner' ? 'common.beginner' : inputLevel === 'Intermediate' ? 'common.intermediate' : 'common.advanced') 
              })}
            </h2>
            {/* --- RESTORE INVISIBLE SPACER --- */}
            {/* This balances the "Back" button and keeps the title centered */}
            <div className="flex items-center text-sm font-medium flex-shrink-0 invisible">
                 <ArrowLeftIcon className="w-4 h-4 mr-1" /> {t('common.back')}
            </div>
            {/* --- END RESTORE --- */}
        </div>
      </div>
      {/* --- NEW: Feedback message for Like/Dislike --- */}
      {articleFeedbackMessage && (
        <div className="text-sm text-green-700 bg-green-100 p-2 rounded text-center">
          {articleFeedbackMessage}
        </div>
      )}
      <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
        {isApiLoading && !visibleNewsResults.length ? ( // Show loading only if results aren't already displayed
          <LoadingSpinner text={t('news.loading')} />
        ) : visibleNewsResults.length === 0 && !isApiLoading ? ( // Show no results message
           <p className="text-center text-gray-500 py-4">{t('news.empty')}</p>
        ) : (
          visibleNewsResults.map((article) => {
            // Check if this lesson is already saved
            const lessonId = btoa(article.link).replace(/\//g, '_').replace(/\+/g, '-');
            const isSaved = lessonHistory.some(l => l.id === lessonId);
            
            // Check if this specific card is loading
            const isLiking = isLikingArticle === article.link;
            const isDisliking = isDislikingArticle === article.link;
            const isCardLoading = isLiking || isDisliking;

            const translation = translatedArticles[article.link];
            const showTranslation = toggledTranslations[article.link] && translation; // Check both toggle and cache
            const isThisArticleTranslating = isTranslating === article.link;

            return (
              <div
                key={article.link}
                className={`flex gap-4 p-4 border border-gray-200 rounded-lg transition duration-150 ${isCardLoading ? 'opacity-50 bg-gray-100' : 'hover:bg-blue-50'}`}
              >
                {article.image && (
                  <img
                  src={article.image}
                  alt=""
                  className="w-20 h-20 object-cover rounded flex-shrink-0"
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              )}
              <div className="flex-grow min-w-0">
                {/* Make the title clickable to open the lesson */}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (isCardLoading) return;
                    handleSelectArticle(article, false);
                  }}
                  className={`text-lg font-semibold text-gray-900 line-clamp-2 ${!isCardLoading && 'hover:text-blue-700'}`}
                >
                 {showTranslation ? translation.translatedTitle : article.title}
                </a>
                <p className="text-sm text-gray-600 line-clamp-2 mt-1"
                   onClick={() => !isCardLoading && handleSelectArticle(article, false)} // Allow clicking text to open
                   style={{ cursor: isCardLoading ? 'default' : 'pointer' }}
                >
                   {showTranslation ? translation.translatedSnippet : article.snippet || ''}
                 </p>
                <p className="text-xs text-gray-400 mt-1">
                  {t('common.source')}: {article.source} ({article.date})
                </p>
              </div>
            {/* --- NEW: Like/Dislike Buttons --- */}
              <div className="flex flex-col justify-center items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleSaveArticle(article)}
                  disabled={isCardLoading || isSaved}
                  title={isSaved ? t('common.alreadySaved') : t('news.saveForLater')}
                  className="p-2 rounded-full transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed text-green-600 disabled:text-gray-400 hover:bg-green-100"
                >
                  {isLiking ? <LoadingSpinner className="w-5 h-5"/> : <ThumbsUpIcon className="w-5 h-5" isSolid={isSaved} />}
                </button>
                <button
                  onClick={() => handleTranslateArticle(article)}
                  disabled={isCardLoading || isThisArticleTranslating}
                  title={showTranslation ? t('news.showOriginalArticle') : t('news.translateArticle')}
                  className="p-2 rounded-full text-blue-600 hover:bg-blue-100 transition duration-150 disabled:opacity-50 disabled:cursor-wait"
                >
                  {isThisArticleTranslating ? (
                    <LoadingSpinner className="w-5 h-5" />
                  ) : (
                    <LanguageIcon className="w-5 h-5" />
                  )}
                </button>
                <button
                  onClick={() => handleDislikeArticle(article)}
                  disabled={isCardLoading}
                  title={t('news.dislikeArticle')}
                  className="p-2 rounded-full text-red-500 hover:bg-red-100 transition duration-150 disabled:opacity-50"
                >
                  {isDisliking ? <LoadingSpinner className="w-5 h-5"/> : <ThumbsDownIcon className="w-5 h-5" />}
                </button>
              </div>
            </div>
            );
          })
         )}
       </div>
     </div>
   );

  const renderLessonView = () => {
    // --- DEBUG LOG ---
    console.log(`[AUDIO_DEBUG] --- renderLessonView: START RENDER ---`);
    console.log(`[AUDIO_DEBUG] renderLessonView: isLessonGenerating: ${isLessonGenerating}`);
    console.log(`[AUDIO_DEBUG] renderLessonView: currentLesson exists: ${!!currentLesson}`);
    // ---
    // Show loading spinner if lesson is being generated or hasn't loaded from state yet
    if (isLessonGenerating || (!currentLesson && currentView === 'LESSON_VIEW')) {
        return (
             <div className="p-4 sm:p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-2xl space-y-6">
                {/* Header for Loading State */}
                <div className="flex flex-wrap justify-between items-center gap-2 border-b pb-3 mb-3">
                     <button onClick={() => navigate('/')} title={t('dashboard.title')}>
                        <img src="/banner.png" alt="StreamLearn Banner Logo" className="h-8 sm:h-10" />
                     </button>
                     {isSubscribed && (
                        <span className="text-sm font-bold text-yellow-600 bg-yellow-100 px-2 py-0.5 rounded-full border border-yellow-500 shadow-sm">
                          {t('common.proBadge')}
                        </span>
                      )}
                     {user && ( <button onClick={handleSignOut} className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1"> {t('common.signOut')} </button> )}
                 </div>
                 <button
                    // Go back to search results
                    onClick={() => goToSearch(inputTopic, inputLevel)}
                    className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
                >
                    <ArrowLeftIcon className="w-4 h-4 mr-1" /> {t('common.back')}
                </button>
                <LoadingSpinner text={t('lesson.generating')} />
             </div>
        );
    }

    // --- NEW: Check view mode ---
    if (lessonViewMode === 'guided') {
      return renderGuidedLesson();
    }

    // Render the lesson content (ensure currentLesson exists here)
    if (!currentLesson) {
       // Fallback case - should ideally not be reached if loading check is correct
       console.error("RenderLessonView: currentLesson is null after loading check.");
       setError(t('lesson.loadFail'));
       goToInput(); // Navigate back safely
       return null; // Don't render anything
    }

    // --- DEBUG LOG (inside the main render return) ---
    console.log(`[AUDIO_DEBUG] renderLessonView (RENDER): summaryAudioSrc exists: ${!!summaryAudioSrc}`);
    console.log(`[AUDIO_DEBUG] renderLessonView (RENDER): summaryAudioDuration: ${summaryAudioDuration}`);
    const shouldShowPlayer = summaryAudioSrc && summaryAudioDuration > 0;
    console.log(`[AUDIO_DEBUG] renderLessonView (RENDER): Player will show: ${shouldShowPlayer}`);
    // ---

    // Render the lesson content
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-2xl space-y-6">
        {/* --- MODIFIED HEADER --- */}
        <div className="flex flex-wrap justify-between items-center gap-2 border-b pb-3 mb-3">
            {/* Banner on the left */}
            <button onClick={() => navigate('/')} title={t('dashboard.title')}>
              <img src="/banner.png" alt="StreamLearn Banner Logo" className="h-8 sm:h-10" />
            </button>
            {isSubscribed && (
                <span className="text-sm font-bold text-yellow-600 bg-yellow-100 px-2 py-0.5 rounded-full border border-yellow-500 shadow-sm">
                  {t('common.proBadge')}
                </span>
              )}
             {/* Action buttons on the right */}
            <div className="flex gap-2 flex-shrink-0">
                 <button
                    onClick={goToInput}
                    className="flex items-center text-indigo-600 hover:text-indigo-800 text-sm font-medium p-1 rounded hover:bg-indigo-50"
                    title={t('lesson.newTopic')}
                  >
                    <RestartIcon className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">{t('lesson.newTopic')}</span>
                  </button>
                 <button
                    onClick={handleSignOut}
                    className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1"
                  >
                    {t('common.signOut')}
                 </button>
            </div>
            {/* Back button and Title on a new line, spanning full width */}
            <div className="w-full flex flex-col sm:flex-row items-center mt-2 gap-2 sm:gap-4">
                 <button
                    onClick={() => goToSearch(inputTopic, inputLevel)}
                    className="flex items-center justify-center sm:justify-start w-full sm:w-auto text-blue-600 hover:text-blue-800 text-sm font-medium flex-shrink-0"
                    title={t('news.back')}
                  >
                    <ArrowLeftIcon className="w-4 h-4 mr-1" /> {t('common.back')}
                  </button>
                {/* Title - allow wrapping */}
                 <h2 className="text-xl sm:text-2xl font-bold text-blue-700 text-center flex-grow min-w-0 break-words px-2 w-full sm:w-auto"> {/* Added break-words and padding */}
                   {currentLesson?.articleTitle || t('lesson.generating')}
                 </h2>
                 {/* --- NEW: Toggle Button --- */}
                 <button
                    onClick={() => setLessonViewMode('guided')}
                    className="flex items-center justify-between w-full sm:w-1/4 font-bold py-3 px-4 rounded-lg text-white
                     bg-gradient-to-b from-blue-500 to-blue-700
                     shadow-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]
                     transition-all duration-150
                     hover:from-blue-600 hover:to-blue-700
                     active:shadow-inner active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] active:translate-y-px"
                    title={t('lesson.switchToGuided')}
                 >
                    <span>{t('lesson.guidedMode')}</span>
                    <ArrowsRightLeftIcon className="w-5 h-5" />
                 </button>
                 {/* Invisible placeholder to balance */}
                 <div className="hidden sm:flex items-center text-sm font-medium flex-shrink-0 invisible">
                      <ArrowLeftIcon className="w-4 h-4 mr-1" /> {t('common.back')}
                 </div>
            </div>
        </div>

        <p className="text-sm text-gray-600">
          <strong>{t('common.source')}</strong> <a href={currentArticle?.link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{currentArticle?.source}</a> ({currentArticle?.date})
        </p>

        {/* Article Summary Section */}
        <div className="space-y-2 border-l-4 border-blue-500 pl-4 bg-blue-50 p-3 rounded-lg">
          <h3 className="text-xl font-bold text-blue-700">{t('lesson.summaryTitle')}</h3>
           {isSummaryAudioLoading && <LoadingSpinner className="w-5 h-5 inline-block mr-2"/>}
           {summaryAudioError && <span className="text-red-600 text-xs ml-2">{t('lesson.audioFail')} {summaryAudioError}</span>}

           {/* --- Summary Audio Player (using your last known render logic) --- */}
           {summaryAudioSrc && summaryAudioDuration > 0 && (
             <div className="flex items-center gap-2 bg-gray-100 p-2 rounded border border-gray-300">
                <button
                   onClick={toggleSummaryPlayPause}
                   className="p-1 text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded flex-shrink-0"
                   aria-label={isSummaryPlaying ? t('lesson.pauseAudio') : t('lesson.playAudio')}
                 >
                   {isSummaryPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
                 </button>
                 <span className="text-xs font-mono text-gray-600 text-center flex-shrink-0">
                     {formatTime(summaryAudioProgress)}
                 </span>
                 <input
                     type="range"
                     className="flex-grow h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer range-sm dark:bg-gray-700 accent-blue-600 min-w-0"
                     min="0"
                     max={summaryAudioDuration}
                     value={summaryAudioProgress}
                     onChange={handleSeek}
                 />
                 <span className="text-xs font-mono text-gray-600 text-center flex-shrink-0">
                     {formatTime(summaryAudioDuration || 0)}
                 </span>
             </div>
           )}
           {/* --- End Audio Player --- */}
          <div className="mt-2 clearfix"> {/* Added clearfix utility */}
             {currentArticle?.image && (
               <a
                 href={currentArticle?.link} // Links to the original article
                 target="_blank"
                 rel="noopener noreferrer"
                 className="float-left mr-4 mb-2 group" // Keep the float and margins
                 title={t('lesson.openOriginalArticle')} // Add a helpful tooltip
               >
                 <img
                   src={currentArticle.image}
                   alt={t('lesson.articleImage')} // Add alt text
                   // Keep size constraints, add hover effect and cursor
                   className="float-left w-20 h-20 sm:w-24 sm:h-24 object-cover rounded mr-4 mb-2 transition-all duration-300 group-hover:scale-110 group-hover:shadow-md cursor-pointer"
                   onError={(e) => (e.currentTarget.style.display = 'none')}
                 />
               </a>
             )}
             <p className="text-gray-800 whitespace-pre-wrap"> {/* Text will now wrap */}
               {currentLesson?.summary}
             </p>
           </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 border-t pt-4 text-sm">
          <button
            onClick={() => startActivity('vocab')}
            disabled={!currentLesson?.vocabularyList || currentLesson.vocabularyList.length === 0}
            className="bg-yellow-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-yellow-600 transition duration-150 disabled:opacity-50"
          >
            {t('lesson.reviewVocab', { count: currentLesson?.vocabularyList?.length || 0 })}
          </button>
          <button
            onClick={() => startActivity('grammar')}
            disabled={!currentLesson?.grammarFocus?.topic}
            className="bg-purple-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-purple-600 transition duration-150 disabled:opacity-50"
          >
            {t('lesson.grammarQuiz', { count: 5 })}
          </button>
          <button
            onClick={() => startActivity('comprehension')}
            disabled={!currentLesson?.comprehensionQuestions || currentLesson.comprehensionQuestions.length === 0}
            className="bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600 transition duration-150 disabled:opacity-50"
          >
            {t('lesson.comprehensionTest', { count: currentLesson?.comprehensionQuestions?.length || 0 })}
          </button>
          {/* --- ADD: Writing Practice Button --- */}
          <button
            onClick={() => startActivity('writing')}
            disabled={!currentLesson?.summary}
            className="bg-sky-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-sky-600 transition duration-150 disabled:opacity-50"
          >
            {t('lesson.writingPractice', { count: 1 })}
          </button>
        </div>

        {/* Vocabulary Section */}
        <div className="space-y-3 border-l-4 border-yellow-500 pl-4 bg-yellow-50 p-3 rounded-lg">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-bold text-yellow-700">{t('lesson.vocabBuilder')}</h3>
            {/* --- START ADD: Show feedback message --- */}
            {wordBankMessage && (
              <span className={`text-sm ${wordBankMessage.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                {wordBankMessage.text}
              </span>
            )}
            {/* --- END ADD --- */}
          </div>
          <ul className="space-y-3">
            {currentLesson?.vocabularyList?.map((item, index) => {
              // --- START ADD: Check if word is saved ---
              const isSaved = wordBank.some(w => w.word === item.word);
              // --- END ADD ---
              
              return (
                <li key={index} className="text-gray-800 flex justify-between items-start gap-2">
                  <div className="flex-grow">
                    <strong className="text-yellow-900">{item.word}:</strong> {item.definition}
                    <p className="text-sm italic text-gray-600 mt-1">{t('common.example')} "{item.articleExample}"</p>
                  </div>
                  {/* --- START ADD: Save Button --- */}
                  <button
                    onClick={() => handleSaveWord(item)}
                    disabled={isSaved}
                    title={isSaved ? t('common.saved') : t('common.saveWord')}
                    className="p-1 text-purple-600 hover:text-purple-800 disabled:text-gray-400 disabled:cursor-default flex-shrink-0"
                  >
                    <BookmarkIcon className="w-5 h-5" isSolid={isSaved} />
                  </button>
                  {/* --- END ADD --- */}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Grammar Section */}
        <div className="space-y-3 border-l-4 border-purple-500 pl-4 bg-purple-50 p-3 rounded-lg">
          <h3 className="text-xl font-bold text-purple-700">{t('lesson.grammarFocus')} {currentLesson?.grammarFocus?.topic}</h3>
          {/* FIX: Removed the <p> wrapper and whitespace-pre-wrap. The renderer handles its own tags. */}
          <MarkdownRenderer content={currentLesson?.grammarFocus?.explanation || ''} className="text-gray-800 mt-2"/>
          <div className="mt-4">
            {/* Render generated examples */}
            {generatedGrammarExamples.length > 0 && (
              <ul className="space-y-2 mb-3">
                {generatedGrammarExamples.map((example, index) => (
                  <li key={index} className="text-gray-700 italic border-t pt-2 flex justify-between items-center">
                    <span>"{example}"</span>
                    <SpeakButton text={example} langCode={targetLanguage} />
                  </li>
                ))}
              </ul>
            )}
            {/* "Get another example" button */}
            <button
              onClick={handleGenerateGrammarExample}
              disabled={isGeneratingExample}
              className="w-full flex items-center justify-center gap-2 text-sm text-blue-600 font-medium bg-blue-100 p-2 rounded-lg hover:bg-blue-200 transition disabled:opacity-50"
            >
              {isGeneratingExample ? (
                <LoadingSpinner className="w-5 h-5" />
              ) : (
                <RestartIcon className="w-5 h-5" />
              )}
              {t('lesson.getNewExample')} 
            </button>
          </div>
        </div>

{/* Comprehension Section */}
        <div className="space-y-3 border-l-4 border-green-500 pl-4 bg-green-50 p-3 rounded-lg">
          <h3 className="text-xl font-bold text-green-700">{t('lesson.comprehensionQuestions')}</h3>
          <ol className="list-decimal list-inside space-y-4">
            {currentLesson?.comprehensionQuestions?.map((q, index) => (
              <li key={index} className="text-gray-800">
                <span>{q}</span>
                {/* --- NEW: Show Answer Button --- */}
                <button
                  onClick={() => handleFetchComprehensionAnswer(q, index)}
                  disabled={isAnswerLoading === index || !!comprehensionAnswers[index]}
                  className="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={comprehensionAnswers[index] ? t('lesson.answerShown') : t('lesson.showAnswer')}
                >
                  {isAnswerLoading === index ? (
                    <LoadingSpinner className="w-4 h-4" />
                  ) : (
                    <LightBulbIcon className="w-4 h-4" />
                  )}
                </button>
                {comprehensionAnswers[index] && (
                  <p className="mt-2 p-2 bg-gray-100 border-l-2 border-gray-400 text-sm text-gray-700 whitespace-pre-wrap">
                    {comprehensionAnswers[index]}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>

        {console.log(`DEBUG_APP: Rendering ChatAssistant. History length: ${chatHistory.length}, ChatLoading: ${isChatLoading}`)}
        <ChatAssistant
          lesson={currentLesson}
          uiLanguage={uiLanguage}
          targetLanguage={targetLanguage}
          history={chatHistory}
          isLoading={isChatLoading}
          error={chatError}
          onSubmit={handleChatSubmit}
          onClearChat={handleClearChat}
          // --- CHANGE IS HERE ---
          // handleFetchAuthToken={handleFetchAuthToken} // <-- REMOVE THIS
          isSubscribed={isSubscribed} // <-- ADD THIS
          liveChatUsageCount={liveChatUsageCount} // <-- ADD THIS
          isUsageLoading={isUsageLoading} // <-- ADD THIS
          onIncrementLiveChatUsage={handleIncrementLiveChatUsage}
          geminiApiKey={import.meta.env.VITE_GEMINI_API_KEY} // <-- ADD THIS PROP
          // --- END CHANGE ---
        />

      </div>
    );
  };

  // --- NEW: Render Activity View ---
  // This function is now a modal wrapper for the Activity components
  const renderActivityView = () => {
    // --- FIX: This is now a modal, so it only renders if activityState is not null ---
     if (!activityState) {
       return null;
     }
 
     const { type, index, score, total, currentData, feedback, isSubmitting } = activityState;
 
     // Show loading spinner if data isn't ready
     if (!currentData) {
       // Determine loading text more accurately based on activityState existence
       const loadingText = activityState?.type === 'grammar'
                           ? t('activity.generatingGrammar')
                           : activityState?.type === 'writing'
                           ? t('activity.generatingWriting')
                           : activityState // If state exists but data doesn't (initial sync load)
                             ? t('common.loading')
                             : t('activity.init'); // If state itself is null

        return (
            <div className="p-6 max-w-2xl mx-auto bg-white rounded-xl shadow-2xl space-y-4">
               <LoadingSpinner text={loadingText} />
               {/* Allow quitting */}
               <button onClick={quitActivity} className="block mx-auto mt-2 text-sm text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
            </div>
          );
    }

     // This should be handled by handleNextActivityQuestion, but as a fallback:
     const isFinished = index >= total;
     if (isFinished) {
        return (
             <div className="p-6 max-w-2xl mx-auto bg-white rounded-xl shadow-2xl space-y-4 text-center">
                 <h2 className="text-2xl font-bold text-blue-700">{t('activity.complete')}</h2>
                 <p className="text-lg text-gray-700">{t('activity.yourScore', { score, total })}</p>
                 <button
                     onClick={quitActivity}
                     className="mt-4 bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 transition duration-150"
                 >
                     {t('activity.backToLesson')}
                 </button>
            </div>
        );
    }


    // Determine background/border color based on feedback
    let feedbackColor = 'border-gray-300'; // Default
    if (feedback.isCorrect === true) feedbackColor = 'border-green-500 bg-green-50';
    if (feedback.isCorrect === false) feedbackColor = 'border-red-500 bg-red-50';

    // This logic is now identical to the one in GuidedLessonFlow
    const translatedType = t(
      type === 'vocab' ? 'activity.vocab' :
      (type === 'grammar' || type === 'grammar_standalone') ? 'activity.grammar' : // <-- FIX
      type === 'comprehension' ? 'activity.comprehension' :
      (type === 'writing' || type === 'writing_standalone') ? 'activity.writing' : // <-- FIX
      type === 'wordbank_study' ? 'wordBank.title' :
      type === 'wordbank_review' ? 'wordBank.title' :
      'activity.writing' // default
    );

    return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-center items-center p-4">
        <div className={`p-6 max-w-2xl w-full mx-auto bg-white rounded-xl shadow-2xl space-y-4 border-2 max-h-[85vh] overflow-y-auto ${feedbackColor}`}>
          {/* Header with Progress and Score */}
          <div className="flex flex-wrap justify-between items-center text-sm text-gray-600 gap-2">
            <span>{t('activity.title', { type: translatedType })}</span>
            {(type === 'grammar_standalone' || type === 'writing_standalone') ? (
              <span>{t('common.score')} {score}</span>
            ) : (
              <span>{t('common.score')} {score}/{total}</span>
            )}
            {(type === 'grammar_standalone' || type === 'writing_standalone') ? (
              <span>{t('common.question')} {index + 1}</span>
            ) : (
              <span>{t('common.question')} {index + 1}/{total}</span>
            )}
            <button onClick={quitActivity} className="text-xs text-gray-500 hover:text-gray-700">{t('common.quit')}</button>
          </div>
          <hr/>

          {/* --- ADD Audio Error Display --- */}
          {activityAudioError && <ErrorMessage message={activityAudioError} />}

          {/* --- NEW: Render the refactored ActivityContent --- */}
          <ActivityContent
           activityState={activityState}
           inputLevel={inputLevel}
           uiLanguage={uiLanguage}
           targetLanguage={targetLanguage}
           isAudioLoading={isActivityAudioLoading}
           onSpeak={handleActivityTextToSpeech}
           onAnswerChange={(answer) => setActivityState(prev => prev ? { ...prev, userAnswer: answer } : null)}
          />

          {/* Feedback Area */}
          {feedback.message && (
            <div className={`mt-4 p-3 rounded text-sm ${feedback.isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {feedback.message}
            </div>
          )}

          {/* --- NEW: Render the refactored ActivityControls --- */}
          <ActivityControls
           activityState={activityState}
           onSubmit={handleSubmitAnswer}
           onNext={handleNextActivityQuestion} // Use the new handler
           isLastStep={index + 1 >= total}
          />
        </div>
      </div>
    );
  };

  // --- Main return ---
  console.log(`DEBUG: Main Render - auth: ${authState}, subLoading: ${isSubLoading}, view: ${currentView}`); // <-- ADD THIS
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100 font-sans"> {/* Changed font */}
      <div className="w-full">
        <InAppBrowserOverlay />
        {/* Global error bar - always show if error exists */}
        {error && <ErrorMessage message={error} />}

        {(authState === 'LOADING' || (authState === 'SIGNED_IN' && isSubLoading)) && (
             <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <LoadingSpinner text={authState === 'LOADING' ? t('common.initializing') : t('common.loading')} />
             </div>
        )}

        {/* Sign in view */}
        {/* FIX: Use LANDING view for SIGNED_OUT state */}
        {authState === 'SIGNED_OUT' && (
          <>
            {currentView === 'LANDING' && (
              <LandingPage
                signInWithGoogle={signInWithGoogle}
                isApiLoading={isApiLoading}
                error={error}
                uiLanguage={uiLanguage}
                setUiLanguage={setUiLanguage}
                navigate={navigate}
                t={t}
                languageCodes={languageCodes}
              />
            )}
            {/* --- ADD THESE RENDER BLOCKS --- */}
            {currentView === 'TERMS' && renderTermsPage()}
            {currentView === 'PRIVACY' && renderPrivacyPage()}
            {currentView === 'PRICING' && renderPricingPage()}
            {/* --- END ADDITION --- */}
          </>
        )}

        {/* --- MODIFIED: Main app view --- */}
        {authState === 'SIGNED_IN' && !isSubLoading && (
            <>
                {currentView === 'DASHBOARD' && renderDashboard()}
                {currentView === 'WORD_BANK' && renderWordBank()} 
                {currentView === 'INPUT' && renderInput()}
                {currentView === 'NEWS_LIST' && renderNewsList()}
                {currentView === 'LESSON_VIEW' && renderLessonView()}
                {currentView === 'ACTIVITY' && renderActivityView()}
                <PracticeCenter 
                  isOpen={isPracticeCenterOpen}
                  onClose={() => setIsPracticeCenterOpen(false)}
                  onStartPractice={startStandaloneActivity}
                  targetLanguage={targetLanguage}
                />
                {currentView === 'PRICING' && renderPricingPage()}
                {currentView === 'TERMS' && renderTermsPage()}
                {currentView === 'PRIVACY' && renderPrivacyPage()}
                
                {currentView === 'LOADING' && (
                    <div className="min-h-screen flex items-center justify-center bg-gray-100">
                        <LoadingSpinner text="Loading..." />
                    </div>
                )}
            </>
        )}
      </div>
    </div>
  );
};

export default App;