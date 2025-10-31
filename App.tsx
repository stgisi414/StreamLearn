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
  deleteDoc, where, addDoc,
  connectFirestoreEmulator, onSnapshot
} from 'firebase/firestore';
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
import { ArrowLeftIcon } from './components/icons/ArrowLeftIcon';
import { VolumeUpIcon } from './components/icons/VolumeUpIcon';
import { PlayIcon } from './components/icons/PlayIcon';
import { PauseIcon } from './components/icons/PauseIcon';
import { CheckCircleIcon } from './components/icons/CheckCircleIcon';
import { Lesson, Article, NewsResult, EnglishLevel, LessonResponse, SavedWord, VocabularyItem, StripeSubscription } from './types';

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
 */
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
type AppView = 'LOADING' | 'SIGN_OUT' | 'DASHBOARD' | 'INPUT' | 'NEWS_LIST' | 'LESSON_VIEW' | 'ACTIVITY' | 'WORD_BANK'
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

// Type for activity state
type ActivityType = 'vocab' | 'grammar' | 'comprehension' | 'writing';
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
  // --- Auth State ---
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<'LOADING' | 'SIGNED_OUT' | 'SIGNED_IN'>('LOADING');

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

  // --- NEW: Subscription State ---
  const [subscription, setSubscription] = useState<StripeSubscription | null>(null);
  const [isSubLoading, setIsSubLoading] = useState(true); // Start true on load
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const isSubscribed = subscription?.status === 'active' || subscription?.status === 'trialing';

  // --- Global Error ---
  const [error, setError] = useState<string | null>(null);

  // --- Loading State (for API calls) ---
  const [isApiLoading, setIsApiLoading] = useState(false);
  const [isLessonGenerating, setIsLessonGenerating] = useState(false);

  // --- Activity state ---
  const [activityState, setActivityState] = useState<ActivityState | null>(null);
  const loadingStepRef = useRef<string | null>(null);
  const activityCancellationRef = useRef(false);

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
  const [inputLevel, setInputLevel] = useLocalStorageState<EnglishLevel>('streamlearn_level', 'Intermediate');
  const [newsResults, setNewsResults] = useLocalStorageState<NewsResult[]>('streamlearn_results', []);
  const [currentArticle, setCurrentArticle] = useLocalStorageState<Article | null>('streamlearn_article', null);
  const [currentLesson, setCurrentLesson] = useLocalStorageState<Lesson | null>('streamlearn_lesson', null);
  const initialUrlHandled = useRef(false);

  // --- Static Data ---
  const newsTopics: string[] = [
    "Technology", "Business", "World News", "US Politics", "Health", "Science",
    "Environment", "Sports", "Entertainment", "Finance", "AI", "Space",
    "Climate Change", "Cybersecurity", "Electric Vehicles", "Global Economy"
  ];

  // --- Firebase Service Memos ---
  const db = useMemo(() => getFirestore(app), []);
  const auth = useMemo(() => getAuth(app), []);
  const functions = useMemo(() => getFunctions(app), []);

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
  const authenticatedFetch = useCallback(async (functionName: string, body: any) => {
    if (!user) {
        setError("You must be signed in to perform this action.");
        throw new Error("Authentication failed: User token missing.");
    }
    let idToken;
    try {
      idToken = await user.getIdToken(true);
    } catch (tokenError) {
      console.error("Error getting ID token:", tokenError);
      setError("Authentication session expired or invalid. Please sign out and sign back in.");
      throw new Error("Failed to get valid ID token.");
    }
    const url = `${BASE_FUNCTION_URL}/${functionName}`;
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`,
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorText = await response.text();
            let errorData: any = {};
            try { errorData = JSON.parse(errorText); } catch { /* Ignore */ }
            const errorMessage = errorData.error || errorData.details || `Request failed with status ${response.status}: ${errorText.substring(0, 100)}`;
            throw new Error(errorMessage);
        }
        return response.json();
    } catch (e) {
        console.error(`Fetch error in ${functionName}:`, e);
        setError(`API request failed: ${(e as Error).message}`);
        throw e;
    }
  }, [user]); // Depends only on user

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

    setIsApiLoading(true);
    setError(null);
    if (!skipNavigation) {
        setNewsResults([]); // Clear results only on user-initiated search
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
        languageCode: 'en'
      }) as NewsResult[];
      if (!results || results.length === 0) {
        setError(`No current news articles found for "${topicToSearch}".`);
        setNewsResults([]); // Ensure results are empty on no results
      } else {
        setNewsResults(results.filter(r => r.title && r.link));
      }
    } catch (e) {
       // Error is already set by authenticatedFetch, view might reset via handleUrlChange if needed
       // Go back to input as a safety measure if API fails badly
       if (!skipNavigation) goToInput();
    } finally {
      setIsApiLoading(false);
    }
  }, [
      authState, user, authenticatedFetch, inputTopic, inputLevel, setNewsResults, 
      setError, goToSearch, goToInput, setCurrentView, 
      isSubscribed, monthlyLessonCount // <-- ADD isSubscribed and monthlyLessonCount
  ]);

  // --- NEW: Helper to fetch summary audio ---
  const fetchSummaryAudio = useCallback(async (summaryText: string) => {
    if (!summaryText || isSummaryAudioLoading || summaryAudioSrc) return; // Don't fetch if loading, already have src, or no text

    console.log("Fetching summary audio...");
    setIsSummaryAudioLoading(true);
    setSummaryAudioError(null);
    setError(null); // Clear main error too

    try {
      const response = await authenticatedFetch('textToSpeech', { text: summaryText });
      if (response.audioContent) {
        const audioData = `data:audio/mp3;base64,${response.audioContent}`;
        setSummaryAudioSrc(audioData); // Set the source, useEffect will create Audio object
        console.log("Summary audio source set.");
      } else {
        throw new Error("Backend did not return audio content for summary.");
      }
    } catch (e) {
      console.error("Summary TTS Fetch Error:", e);
      setSummaryAudioError(`Failed to get summary audio: ${(e as Error).message}`);
    } finally {
      setIsSummaryAudioLoading(false);
    }
  }, [authenticatedFetch, isSummaryAudioLoading, summaryAudioSrc]); // Added dependencies

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
            summaryAudioRef.current = null;
        }
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
            // --- FIX: Assign to the outer responseData ---
            responseData = await authenticatedFetch('createLesson', {
            // --- END FIX ---
                articleUrl: article.link,
                level: inputLevel,
                title: article.title,
                snippet: article.snippet || ''
            });

            if (responseData?.success && responseData?.lesson) { // Added null checks
                lessonToSave = responseData.lesson as Lesson;
                console.log("Lesson generated successfully, calling setCurrentLesson.");
                setCurrentLesson(lessonToSave);
                if (lessonToSave.summary) {
                    fetchSummaryAudio(lessonToSave.summary);
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
               fetchSummaryAudio(lessonToSave.summary);
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
      summaryAudioSrc, isSummaryAudioLoading
      // --- END REMOVAL ---
  ]);

  const handleSaveWord = async (vocabItem: VocabularyItem) => {
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
      createdAt: Timestamp.now()
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
  };

  const handleDeleteWord = async (word: string) => {
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
  };

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

    // Set all the state required to open the lesson
    setCurrentArticle(article);
    setCurrentLesson(lesson.lessonData);
    setInputTopic(lesson.topic);
    setInputLevel(lesson.level);

    // Navigate to the lesson view
    navigate('/lesson', `?url=${encodeURIComponent(lesson.articleUrl)}`, { article });

  }, [navigate, setCurrentArticle, setCurrentLesson, setInputTopic, setInputLevel, currentArticle?.image]);

  // --- NEW: Subscription Functions ---
  const fetchSubscriptionStatus = useCallback(async (user: User) => {
    if (!user) return;
    console.log("Fetching subscription status...");
    setIsSubLoading(true);
    try {
      // Note: This query is simple. The Stripe extension *overwrites* docs,
      // so we just look for the first active/trialing one.
      const subRef = collection(db, `customers/${user.uid}/subscriptions`); // <--- FIX HERE
      const q = query(subRef, where("status", "in", ["active", "trialing"]), limit(1));
      
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        setSubscription(null);
        setIsSubLoading(true);
        console.log("No active subscription found.");
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
    console.log("handleUrlChange received:", path, params.toString());
    if (authState !== 'SIGNED_IN') {
      if (authState === 'SIGNED_OUT') {
        console.log("Setting view to SIGN_OUT");
        setCurrentView('SIGN_OUT');
      } else {
        console.log("Auth not ready, setting view to LOADING");
        setCurrentView('LOADING'); // Set loading until auth is ready
      }
      return;
    }

    let nextView: AppView | null = null; // Use null to detect if a branch was hit

    if (path.startsWith('/lesson')) {
      const urlParam = params.get('url');
      const articleForCheck = newState?.article !== undefined ? newState.article : currentArticle;

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
        if ((!newsResults.length || inputTopic !== query || inputLevel !== level) && !isApiLoading) {
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
    } else if (path.startsWith('/pricing')) { // <-- ADD THIS
      nextView = 'PRICING';
    } else if (path.startsWith('/terms')) { // <-- ADD THIS
      nextView = 'TERMS';
    } else if (path.startsWith('/privacy')) { // <-- ADD THIS
      nextView = 'PRIVACY';
    } else { // Default path '/'
      nextView = 'DASHBOARD'; // <-- CHANGE HERE
    }

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

    if (path.startsWith('/lesson') && authState === 'SIGNED_IN') {
        const urlParam = params.get('url');
        const articleForCheck = newState?.article !== undefined ? newState.article : currentArticle;

        if (urlParam && currentLesson && articleForCheck && articleForCheck.link === urlParam) {
            // Lesson and article match URL, check if audio needs fetching
            if (currentLesson.summary && !summaryAudioSrc && !isSummaryAudioLoading) {
               console.log("handleUrlChange: Fetching summary audio for existing lesson on nav/refresh.");
               fetchSummaryAudio(currentLesson.summary);
            }
        }
     }

  }, [
    // Keep all dependencies here
    authState, currentLesson, currentArticle, newsResults, inputTopic, inputLevel, isApiLoading,
    setCurrentView, setInputTopic, setInputLevel, setError, setNewsResults, setCurrentArticle, setCurrentLesson, // Added missing setters
    handleSelectArticle, handleFindArticles, goToInput, // Ensure these are stable (defined with useCallback)
    fetchSummaryAudio, summaryAudioSrc, isSummaryAudioLoading,
  ]);

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

    // Handle initial load once auth is ready
    if (authState !== 'LOADING' && !initialUrlHandled.current) { // <-- MODIFY THIS LINE
        initialUrlHandled.current = true; // <-- ADD THIS LINE
        const { pathname, search } = window.location;
        handleUrlChangeRef.current(pathname, new URLSearchParams(search));
    }

    return () => {
        window.removeEventListener('popstate', handlePopState);
    };
  }, [authState]); // Rerun only when authState changes

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

  // --- Auth state listener ---
   useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setAuthState('SIGNED_IN');
        fetchSubscriptionStatus(currentUser);
        setError(null);
      } else {
        setUser(null);
        setAuthState('SIGNED_OUT');
        setCurrentView('SIGN_OUT');
        setLessonHistory([]); //
        setWordBank([]);
        setDashboardSearchTerm('');
        initialUrlHandled.current = false;
      }
    });
    return () => unsubscribe();
  }, [auth, setCurrentView, fetchSubscriptionStatus]);

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

      // --- Return cleanup function ---
      return () => {
        historyUnsubscribe();
        wordBankUnsubscribe();
      };
    }
  }, [user, db]); // This effect re-runs when the user logs in or out

  // --- Google Sign-In Handler ---
  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
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
      setCurrentLesson(null);
      setNewsResults([]);
      setInputTopic(''); // Optionally clear topic
    } catch (e) {
      console.error("Sign Out Error:", e);
      setError(`Sign out failed: ${(e as Error).message}`);
    }
  };

  // --- NEW: Activity Logic ---
  const startActivity = (type: ActivityType) => {
    if (!currentLesson) return;
    activityCancellationRef.current = false; // <<< ADD THIS LINE: Reset cancellation flag
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
        setError(`No ${type} items available for this lesson.`);
        return;
    }

    setActivityState({
      type: type,
      index: 0,
      score: 0,
      total: totalItems,
      shuffledIndices: shuffledIndices, // <-- Store shuffled indices (will be undefined for non-vocab)
      currentData: null,
      userAnswer: null,
      feedback: { isCorrect: null, message: '' },
      isSubmitting: false,
    });
    setCurrentView('ACTIVITY');
  };

  const quitActivity = useCallback(() => {
      activityCancellationRef.current = true; // Signal cancellation
      setActivityState(null);

      // Stop and clear any active activity audio
      if (activityAudioRef.current) {
          activityAudioRef.current.pause();
          activityAudioRef.current = null;
      }
      setIsActivityAudioLoading(false); // Reset loading state
      setActivityAudioError(null);    // Reset error state

      goToLesson(currentArticle!); // Go back to the lesson URL
  }, [goToLesson, currentArticle]);

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


  // Effect to load data for the current activity step (REVISED AGAIN - Simpler Loading Logic)
  useEffect(() => {
    // --- Early exit if not in the right view or state is missing ---
    if (currentView !== 'ACTIVITY' || !activityState || !currentLesson) {
      console.log("Activity useEffect: Bailing early (not in activity view or missing state)");
      return;
    }

    const { type, index, total, shuffledIndices, currentData, isSubmitting } = activityState;
    const currentStepKey = `${type}-${index}`; // Unique identifier for this step

    // --- Handle activity completion ---
    if (index >= total) {
      console.log(`Activity finished check: index ${index} >= total ${total}.`);
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

    if (type === 'vocab' && shuffledIndices) {
      dataPromise = Promise.resolve().then(() => { // Wrap sync logic in resolved promise
        const actualItemIndex = shuffledIndices[index];
        if (actualItemIndex >= currentLesson.vocabularyList.length) throw new Error(`Invalid shuffled index ${actualItemIndex}`);
        const currentVocabItem = currentLesson.vocabularyList[actualItemIndex];
        if (!currentVocabItem || !currentVocabItem.word || !currentVocabItem.definition) throw new Error(`Invalid vocab item at index ${actualItemIndex}`);
        let dataForStep: any = { word: currentVocabItem.word, definition: currentVocabItem.definition };
        if (inputLevel !== 'Advanced') {
          const numOptions = inputLevel === 'Beginner' ? 2 : 4;
          const otherIndices = shuffledIndices.filter((_, i) => i !== index);
          const distractors = shuffleArray(otherIndices).slice(0, numOptions - 1).map(idx => currentLesson.vocabularyList[idx].word);
          dataForStep.options = shuffleArray([ currentVocabItem.word, ...distractors ]);
        }
        return dataForStep;
      });
    } else if (type === 'comprehension') {
      dataPromise = Promise.resolve().then(() => { // Wrap sync logic in resolved promise
        if (index >= currentLesson.comprehensionQuestions.length) throw new Error(`Index ${index} out of bounds for comprehension`);
        const questionText = currentLesson.comprehensionQuestions[index];
        if (!questionText || typeof questionText !== 'string') throw new Error(`Invalid comprehension question at index ${index}`);
        return { question: questionText, summary: currentLesson.summary };
      });
    } else if (type === 'grammar') {
    console.log(`Setting loading ref and starting grammar fetch for ${currentStepKey}...`);
    loadingStepRef.current = currentStepKey;
    setActivityState(prev => { // Set loading state immediately *before* fetch
         if (!prev || prev.index !== index || prev.type !== 'grammar') return prev; // Check relevance
         return { ...prev, isSubmitting: true, currentData: null, userAnswer: null, feedback: {isCorrect: null, message: ''}}; // Clear old data/answer/feedback
    });

    // *** ADD SAFETY CHECKS & LOGGING HERE ***
    const grammarPayload = {
        topic: currentLesson?.grammarFocus?.topic, // Use optional chaining
        explanation: currentLesson?.grammarFocus?.explanation, // Use optional chaining
        level: inputLevel
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
  } else if (type === 'writing') {
      console.log(`Setting loading ref and starting writing fetch for ${currentStepKey}...`);
      loadingStepRef.current = currentStepKey;
      setActivityState(prev => {
         if (!prev || prev.index !== index || prev.type !== 'writing') return prev;
         return { ...prev, isSubmitting: true, currentData: null, userAnswer: null, feedback: {isCorrect: null, message: ''}};
      });

      const payload = {
        summary: currentLesson.summary,
        level: inputLevel,
        vocabularyList: currentLesson.vocabularyList.map(v => v.word)
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
            if (fetchedData?.prompt) { return fetchedData; }
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

     if (loadingStepRef.current !== currentStepKey && (type === 'grammar' || type === 'writing')) {
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
      currentView, activityState?.type, activityState?.index, // Step definition
      activityState?.shuffledIndices, // Needed for vocab order
      inputLevel, currentLesson, // Data sources
      authenticatedFetch, quitActivity, setError, shuffleArray // Stable functions
  ]);

  const handleSubmitAnswer = async () => {
    if (!activityState || !activityState.currentData || activityState.userAnswer === null || activityState.feedback.isCorrect !== null) return;

    setActivityState(prev => prev ? ({ ...prev, isSubmitting: true }) : null);
    setError(null);

    const { type, currentData, userAnswer, score } = activityState;
    let isCorrect: boolean = false;
    let feedbackMsg: string = '';

    try {
        if (type === 'vocab') {
            // --- MODIFIED: Direct check for both MC and Fill-in-the-blank ---
            isCorrect = String(userAnswer).trim().toLowerCase() === String(currentData.word).trim().toLowerCase();
            feedbackMsg = isCorrect ? "Correct!" : `Incorrect. The word was "${currentData.word}".`;

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
                    userAnswer: String(userAnswer)
                }
            });
            setActivityState(prev => {
                if (!prev) return null;
                const newScore = result.isCorrect ? prev.score + 1 : prev.score;
                return {
                  ...prev,
                  feedback: { isCorrect: result.isCorrect, message: result.feedback || (result.isCorrect ? 'Correct!' : 'Incorrect.') },
                  score: newScore,
                  isSubmitting: false
                };
            });

        } else if (type === 'comprehension') {
            // Comprehension grading remains the same (uses backend)
             const result = await authenticatedFetch('handleActivity', {
                activityType: 'comprehension',
                payload: {
                    question: currentData.question,
                    summary: currentData.summary,
                    userAnswer: String(userAnswer)
                }
             });
             setActivityState(prev => {
                 if (!prev) return null;
                 const newScore = result.isCorrect ? prev.score + 1 : prev.score;
                 return {
                   ...prev,
                   feedback: { isCorrect: result.isCorrect, message: result.feedback || (result.isCorrect ? 'Correct!' : 'Incorrect.') },
                   score: newScore,
                   isSubmitting: false
                 };
             });
        } else if (type === 'writing') {
             const result = await authenticatedFetch('handleActivity', {
                activityType: 'writing_grade',
                payload: {
                    prompt: currentData.prompt,
                    summary: currentLesson.summary,
                    userAnswer: String(userAnswer),
                    level: inputLevel // <-- Pass the level for grading context
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
        }

    } catch (err) {
      setError(`Error submitting answer: ${(err as Error).message}`);
      setActivityState(prev => prev ? ({ ...prev, isSubmitting: false }) : null);
    }
  };

   const handleNextQuestion = () => {
      setActivityState(prev => {
         if (!prev || prev.index + 1 >= prev.total) {
             // Finished! Handle end state later. For now, go back to lesson.
             quitActivity();
             return null;
         }
         return {
             ...prev,
             index: prev.index + 1,
             currentData: null, // Will trigger useEffect to load/generate next
             userAnswer: null,
             feedback: { isCorrect: null, message: '' }
         };
     });
   };

   // --- Activity Text-to-Speech Handler (Renamed) ---
  const handleActivityTextToSpeech = async (text: string | undefined | null) => { // Renamed function
    console.log("handleActivityTextToSpeech called with text:", text);

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
        const response = await authenticatedFetch('textToSpeech', { text });
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
  };

  // --- NEW: Summary Audio Player Logic ---
  // Effect to create Audio object when src changes
  useEffect(() => {
    if (summaryAudioSrc && !summaryAudioRef.current) {
      console.log("Creating new Audio object for summary");
      const audio = new Audio(summaryAudioSrc);
      summaryAudioRef.current = audio;

      const setAudioData = () => {
        if (summaryAudioRef.current) {
          setSummaryAudioDuration(summaryAudioRef.current.duration);
          setSummaryAudioProgress(summaryAudioRef.current.currentTime);
        }
      };

      const setAudioTime = () => {
        if (summaryAudioRef.current) {
          setSummaryAudioProgress(summaryAudioRef.current.currentTime);
        }
      };

      const setAudioEnd = () => {
        setIsSummaryPlaying(false);
        setSummaryAudioProgress(0); // Reset progress on end
      };

      audio.addEventListener("loadedmetadata", setAudioData);
      audio.addEventListener("timeupdate", setAudioTime);
      audio.addEventListener("ended", setAudioEnd);

      // Cleanup
      return () => {
        audio.removeEventListener("loadedmetadata", setAudioData);
        audio.removeEventListener("timeupdate", setAudioTime);
        audio.removeEventListener("ended", setAudioEnd);
        audio.pause(); // Ensure it stops if component unmounts
        summaryAudioRef.current = null; // Clean up ref
      };
    } else if (!summaryAudioSrc && summaryAudioRef.current) {
        // If src is cleared, clean up the existing audio object
        summaryAudioRef.current.pause();
        summaryAudioRef.current = null;
    }
  }, [summaryAudioSrc]); // Re-run only when src changes

  const toggleSummaryPlayPause = () => {
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
        fetchSummaryAudio(currentLesson.summary);
    }
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (summaryAudioRef.current) {
      const time = Number(event.target.value);
      summaryAudioRef.current.currentTime = time;
      setSummaryAudioProgress(time);
    }
  };

  // Helper to format time (MM:SS)
  const formatTime = (timeInSeconds: number): string => {
    if (isNaN(timeInSeconds) || timeInSeconds < 0) return "00:00";
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // --- Render Functions ---

  const renderDashboard = () => (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto bg-white rounded-xl shadow-2xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-2 border-b pb-3">
        <img src="/banner.png" alt="StreamLearn Banner Logo" className="h-8 sm:h-10" />
        {isSubscribed && (
            <span className="text-sm font-bold text-yellow-600 bg-yellow-100 px-2 py-0.5 rounded-full border border-yellow-500 shadow-sm">
              PRO
            </span>
          )}
        {user && (
          <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1 flex-shrink-0"
          >
            Sign Out ({user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'User'})
          </button>
        )}
      </div>

      {/* Quick Actions */}
      {/* --- START: Updated Quick Actions --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          onClick={goToInput}
          className="flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition duration-150 shadow-lg"
        >
          <RestartIcon className="w-5 h-5" /> Start New Lesson
        </button>
        <button
          onClick={() => navigate('/wordbank')}
          disabled={isWordBankLoading}
          className="flex items-center justify-center gap-2 bg-purple-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-purple-600 transition duration-150 shadow-lg disabled:opacity-50"
        >
          <BookOpenIcon className="w-5 h-5" />
          My Word Bank ({wordBank.length})
        </button>

        {/* Subscription Button */}
        {isBillingLoading ? (
            <button disabled className="flex items-center justify-center gap-2 bg-gray-400 text-white font-bold py-3 px-4 rounded-lg shadow-lg disabled:opacity-50">
              <LoadingSpinner className="w-5 h-5" /> Loading...
            </button>
        ) : isSubscribed ? (
            <button
              onClick={handleManageBilling}
              className="flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700 transition duration-150 shadow-lg"
            >
              <CreditCardIcon className="w-5 h-5" /> Manage Billing
            </button>
        ) : (
            <button
              onClick={() => navigate('/pricing')}
              className="flex items-center justify-center gap-2 bg-green-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-600 transition duration-150 shadow-lg"
            >
              <CreditCardIcon className="w-5 h-5" /> Upgrade to Pro
            </button>
        )}
      </div>
      {/* --- END: Updated Quick Actions --- */}
      
      {/* Footer for TOS/Privacy */}
      <div className="text-center text-xs text-gray-400 space-x-4 pt-2">
        <a href="/terms" onClick={(e) => { e.preventDefault(); navigate('/terms'); }} className="hover:underline">Terms of Service</a>
        <span>&bull;</span>
        <a href="/privacy" onClick={(e) => { e.preventDefault(); navigate('/privacy'); }} className="hover:underline">Privacy Policy</a>
      </div>

      {/* Lesson History */}
      <div className="space-y-3">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 border-t pt-4">Your Lesson History</h2>

        <div className="relative">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <SearchIcon className="w-5 h-5 text-gray-400" />
          </div>
          <input
            type="text"
            value={dashboardSearchTerm}
            onChange={(e) => setDashboardSearchTerm(e.target.value)}
            placeholder="Search by title, topic, or source..."
            className="w-full p-3 pl-10 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {isHistoryLoading ? (
          <LoadingSpinner text="Loading your lessons..." />
        ) : lessonHistory.length === 0 ? (
          <p className="text-center text-gray-500 py-4">You haven't completed any lessons yet. Start a new one!</p>
        ) : (
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
            {filteredLessonHistory.map((lesson) => (
              <button
                key={lesson.id}
                onClick={() => handleSelectPastLesson(lesson)}
                className="w-full flex gap-3 items-center p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-blue-50 transition duration-150 text-left"
              >
                {lesson.image ? (
                  <img
                    src={lesson.image}
                    alt=""
                    className="w-16 h-16 object-cover rounded flex-shrink-0"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                ) : (
                  <div className="w-16 h-16 flex items-center justify-center bg-gray-100 rounded flex-shrink-0">
                    <HistoryIcon className="w-8 h-8 text-blue-400" />
                  </div>
                )}
                <div className="flex-grow min-w-0">
                  <p className="text-lg font-semibold text-gray-900 line-clamp-2">
                    {lesson.lessonData.articleTitle}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    Topic: <span className="font-medium text-gray-800">{lesson.topic}</span>
                    <span className="mx-2">|</span>
                    Level: <span className="font-medium text-gray-800">{lesson.level}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Source: {lesson.source} ({lesson.date})
                  </p>
                </div>
                <ArrowLeftIcon className="w-5 h-5 text-gray-400 transform rotate-180 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

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
            title="Back to Dashboard"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" /> Dashboard
        </button>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">My Word Bank</h2>
        {user && (
          <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1 flex-shrink-0"
          >
            Sign Out
          </button>
        )}
      </div>

      {/* Temporary Message */}
      {wordBankMessage && (
        <div className={`p-2 text-sm text-center rounded ${wordBankMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {wordBankMessage.text}
        </div>
      )}

      {/* Word List */}
      <div className="space-y-3">
        {isWordBankLoading ? (
          <LoadingSpinner text="Loading your saved words..." />
        ) : wordBank.length === 0 ? (
          <p className="text-center text-gray-500 py-4">You haven't saved any words yet. Save words from the vocabulary list in your lessons!</p>
        ) : (
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
            {wordBank.map((item) => (
              <div
                key={item.id}
                className="flex gap-3 items-start p-4 border border-gray-200 rounded-lg"
              >
                <div className="flex-grow min-w-0">
                  <strong className="text-lg text-purple-800">{item.word}</strong>
                  <p className="text-gray-700">{item.definition}</p>
                  <p className="text-sm italic text-gray-500 mt-1">
                    Example: "{item.articleExample}"
                    <SpeakButton text={item.articleExample} />
                  </p>
                </div>
                <button
                  onClick={() => handleDeleteWord(item.word)}
                  title="Delete word"
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
        )}
      </div>
    </div>
  );

  // --- NEW: Reusable SpeakButton ---
  const SpeakButton = ({ text }: { text: string | undefined | null }) => (
    <button
       onClick={() => {
           console.log("SpeakButton clicked. Text:", text);
           handleActivityTextToSpeech(text);
       }}
       disabled={isActivityAudioLoading || !text}
       className="ml-2 p-1 text-gray-500 hover:text-blue-600 disabled:opacity-50 inline-block align-middle cursor-pointer disabled:cursor-not-allowed"
       title="Read aloud"
     >
       {isActivityAudioLoading ? (
            <LoadingSpinner className="w-4 h-4 inline-block" />
       ) : (
            <VolumeUpIcon className="w-5 h-5" />
       )}
    </button>
  );

  const StaticPageWrapper: React.FC<{ title: string, children: React.ReactNode }> = ({ title, children }) => (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto bg-white rounded-xl shadow-2xl space-y-5">
      <div className="flex justify-between items-center gap-2 border-b pb-3">
        <button
            onClick={() => navigate('/')} // Back to Dashboard
            className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
            title="Back to Dashboard"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" /> Dashboard
        </button>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">{title}</h2>
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
          title="Back to Dashboard"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-1" /> Dashboard
        </button>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center">
          Plans & Pricing
        </h1>
        {user ? (
          <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1 flex-shrink-0"
          >
            Sign Out
          </button>
        ) : (
          <div className="w-24"></div> // Spacer to balance the header
        )}
      </div>
      
      <p className="text-lg text-gray-600 text-center">
        Choose the plan that's right for your learning journey.
      </p>

      {/* Pricing Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
        
        {/* Free Plan Card */}
        <div className="border border-gray-200 rounded-xl p-6 shadow-lg flex flex-col">
          <h2 className="text-2xl font-semibold text-gray-800">Free Plan</h2>
          <p className="text-gray-500 mt-2">Perfect for trying out the app.</p>
          
          <div className="my-6">
            <span className="text-4xl font-extrabold text-gray-900">$0</span>
            <span className="text-lg font-medium text-gray-500">/ month</span>
          </div>
          
          <ul className="space-y-3 mb-8">
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-green-500 flex-shrink-0" />
              <span className="text-gray-700"><strong>{FREE_LESSON_LIMIT} free lessons</strong> per month</span>
            </li>
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-green-500 flex-shrink-0" />
              <span className="text-gray-700">Full access to all activity types</span>
            </li>
          </ul>
          
          {/* Spacer to push button to bottom */}
          <div className="flex-grow"></div> 
          
          <button
            onClick={() => navigate('/')} // Just go back to dashboard
            className="w-full bg-white text-blue-600 border border-blue-600 font-bold py-3 px-6 rounded-lg hover:bg-blue-50 transition duration-150"
          >
            Your Current Plan
          </button>
        </div>

        {/* Pro Plan Card (Featured) */}
        <div className="border-2 border-blue-600 rounded-xl p-6 shadow-2xl relative flex flex-col bg-gray-50">
          {/* "Most Popular" Badge */}
          <div className="absolute top-0 -translate-y-1/2 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center px-4 py-1 rounded-full text-sm font-semibold text-white bg-blue-600 shadow-md">
              Most Popular
            </span>
          </div>

          <h2 className="text-2xl font-semibold text-blue-700">StreamLearn Pro</h2>
          <p className="text-gray-500 mt-2">Unlimited access to all features.</p>
          
          <div className="my-6">
            <span className="text-4xl font-extrabold text-gray-900">$20</span>
            <span className="text-lg font-medium text-gray-500">/ month</span>
          </div>
          
          <p className="text-sm text-gray-500 -mt-2 text-center">Cancel anytime.</p>
          
          <ul className="space-y-3 my-8">
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-blue-600 flex-shrink-0" />
              <span className="text-gray-700"><strong>Unlimited</strong> lesson generation</span>
            </li>
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-blue-600 flex-shrink-0" />
              <span className="text-gray-700"><strong>Unlimited</strong> vocabulary practice</span>
            </li>
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-blue-600 flex-shrink-0" />
              <span className="text-gray-700"><strong>Unlimited</strong> writing practice</span>
            </li>
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-blue-600 flex-shrink-0" />
              <span className="text-gray-700"><strong>Full access</strong> to your lesson history</span>
            </li>
            <li className="flex items-center gap-3">
              <CheckCircleIcon className="w-6 h-6 text-blue-600 flex-shrink-0" />
              <span className="text-gray-700"><strong>Full access</strong> to your Word Bank</span>
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
            ) : "Get Started with Pro"}
          </button>
        </div>
      </div>
    </div>
  );

    // ... (code around line 1183) ...

  const renderTermsPage = () => (
    <StaticPageWrapper title="Terms of Service">
      <>
        <p className="lead">Last updated: October 30, 2025</p>
        <p>
          Welcome to StreamLearn! These Terms of Service ("Terms") govern your
          access to and use of the StreamLearn website, services, and
          applications (collectively, the "Service"). Please read these Terms
          carefully.
        </p>

        <h3>1. Acceptance of Terms</h3>
        <p>
          By creating an account, accessing, or using the Service, you agree to
          be bound by these Terms. If you do not agree to these Terms, do not
          use the Service.
        </p>

        <h3>2. The Service</h3>
        <p>
          StreamLearn is a language learning platform that helps users learn
          English by generating customized lessons based on current news
          articles. The Service uses third-party APIs, including the Gemini API
          and Bright Data SERP API, to find articles and generate lesson
          content.
        </p>
        <p>
          We offer a free tier with limited usage (e.g., a limited number of
          lessons per month) and a paid "StreamLearn Pro" subscription plan
          with expanded features.
        </p>

        <h3>3. User Accounts</h3>
        <p>
          To use most features of the Service, you must register for an account
          by authenticating with Google Sign-In. You agree to:
        </p>
        <ul>
          <li>
            Be solely responsible for all activities that occur under your
            account.
          </li>
          <li>
            Notify us immediately at{' '}
            <a href="mailto:support@streamlearn.xyz">
              support@streamlearn.xyz
            </a>{' '}
            of any unauthorized use of your account.
          </li>
        </ul>

        <h3>4. Subscriptions and Payments</h3>
        <p>
          <strong>Billing:</strong> We use a third-party payment processor
          (Stripe) to bill you for subscription plans. The processing of
          payments is subject to the terms and conditions of Stripe. We do not
          store your credit card information.
        </p>
        <p>
          <strong>Recurring Charges:</strong> By purchasing a subscription, you
          authorize us to charge your payment method on a recurring (e.g.,
          monthly) basis, at the rate then in effect, until you cancel.
        </p>
        <p>
          <strong>Cancellation:</strong> You may cancel your subscription at any
          time through the "Manage Billing" portal on your dashboard.
          Cancellation will be effective at the end of your current billing
          cycle.
        </p>

        <h3>5. User Content</h3>
        <p>
          You retain all rights to the content you create or store in the
          Service, such as your saved lesson history and personal word bank.
          You grant us a limited, non-exclusive, worldwide, royalty-free
          license to use, store, and display your content solely for the
          purpose of providing and improving the Service *to you*.
        </p>

        <h3>6. Third-Party Links & Content</h3>
        <p>
          The Service generates lessons based on content from third-party news
          websites. We are not responsible for the accuracy, legality, or
          content of these external sites or the articles sourced from them.
          Your access and use of such third-party content is at your own risk.
        </p>

        <h3>7. Termination</h3>
        <p>
          You are free to stop using the Service at any time. We reserve the
          right to suspend or terminate your account at our discretion, without
          notice, if you breach these Terms.
        </p>

        <h3>8. Disclaimers and Limitation of Liability</h3>
        <p>
          THE SERVICE IS PROVIDED "AS IS." TO THE FULLEST EXTENT PERMITTED BY
          LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED. WE WILL NOT BE
          LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
          PUNITIVE DAMAGES ARISING OUT OF OR RELATING TO YOUR USE OF THE
          SERVICE.
        </p>

        <h3>9. Changes to Terms</h3>
        <p>
          We may modify these Terms at any time. We will notify you of any
          changes by posting the new Terms on this page. Your continued use of
          the Service after such changes constitutes your acceptance of the new
          Terms.
        </p>

        <h3>10. Contact Us</h3>
        <p>
          If you have any questions about these Terms, please contact us at{' '}
          <a href="mailto:support@streamlearn.xyz">
            support@streamlearn.xyz
          </a>
          .
        </p>
      </>
    </StaticPageWrapper>
  );

  const renderPrivacyPage = () => (
    <StaticPageWrapper title="Privacy Policy">
      <>
        <p className="lead">Last updated: October 30, 2025</p>
        <p>
          This Privacy Policy describes how StreamLearn ("we," "us," or "our")
          collects, uses, and shares your information when you use our Service.
        </p>

        <h3>1. Information We Collect</h3>
        <ul>
          <li>
            <strong>Account Information:</strong> When you sign up using Google
            Sign-In, we receive your name, email address, and profile picture
            as provided by Google.
          </li>
          <li>
            <strong>User Content:</strong> We collect and store the information
            you create within the app, including your saved lessons, your
            personal word bank, and your chosen topics of interest.
          </li>
          <li>
            <strong>Payment Information:</strong> We do not collect or store
            your payment card details. Our third-party payment processor,
            Stripe, handles all payment transactions. We only store your Stripe
            Customer ID and your subscription status (e.g., "active", "free").
          </li>
        </ul>

        <h3>2. How We Use Information</h3>
        <p>
          We use your information for the following purposes:
        </p>
        <ul>
          <li>To provide, maintain, and improve the Service.</li>
          <li>
            To personalize your learning experience by saving your lessons and
            word bank.
          </li>
          <li>To process your subscription payments via Stripe.</li>
          <li>
            To communicate with you, such as responding to support requests
            sent to{' '}
            <a href="mailto:support@streamlearn.xyz">
              support@streamlearn.xyz
            </a>
            .
          </li>
        </ul>

        <h3>3. How We Share Information</h3>
        <p>
          We do not sell your personal information. We share information only
          in the following limited circumstances:
        </p>
        <ul>
          <li>
            <strong>Third-Party Service Providers:</strong>
            <ul>
              <li>
                <strong>Google:</strong> For authentication (Google Sign-In) and
                data storage (Google Cloud Firestore).
              </li>
              <li>
                <strong>Stripe:</strong> To process subscription payments and
                manage billing.
              </li>
              <li>
                <strong>Google (Gemini API):</strong> Prompts you generate
                (like lesson requests, topics, and activity answers) are sent
                to the Gemini API to generate responses.
              </li>
              <li>
                <strong>Bright Data:</strong> Your search topics are sent to the
                Bright Data SERP API to find news articles.
              </li>
              <li>
                <strong>Google Cloud TTS:</strong> Text you select for text-to-speech
                is sent to Google's API to generate audio.
              </li>
            </ul>
          </li>
          <li>
            <strong>Legal Requirements:</strong> We may disclose your
            information if required to do so by law or in response to valid
            requests by public authorities.
          </li>
        </ul>

        <h3>4. Data Storage and Security</h3>
        <p>
          Your personal data (account info, lesson history, word bank) is
          stored using Google Cloud Firestore, a service operated by Google.
          We take reasonable measures to protect your information, but no
          security system is impenetrable.
        </p>
        <h3>5. Your Rights</h3>
        <p>
          Depending on your location, you may have rights regarding your
          personal information, such as the right to access, correct, or
          delete your data. To make such a request, please contact us at{' '}
          <a href="mailto:support@streamlearn.xyz">
            support@streamlearn.xyz
          </a>
          .
        </p>

        <h3>6. Children's Privacy</h3>
        <p>
          The Service is not intended for or directed to children under the
          age of 13. We do not knowingly collect personal information from
          children under 13.
        </p>

        <h3>7. Changes to This Policy</h3>
        <p>
          We may update this Privacy Policy from time to time. We will notify
          you of any changes by posting the new policy on this page.
        </p>

        <h3>8. Contact Us</h3>
        <p>
          If you have any questions about this Privacy Policy, please contact
          us at{' '}
          <a href="mailto:support@streamlearn.xyz">
            support@streamlearn.xyz
          </a>
          .
        </p>
      </>
    </StaticPageWrapper>
  );

  const renderInput = () => {
    const isFreeTierLimitReached = !isSubscribed && monthlyLessonCount >= FREE_LESSON_LIMIT;

    return (
      // Add padding-x for mobile screens to prevent elements touching edges
      <div className="p-4 sm:p-6 max-w-lg mx-auto bg-white rounded-xl shadow-2xl space-y-6">
        {/* Use flex-wrap and justify-between for better mobile header layout */}
        <div className="flex flex-wrap justify-between items-center gap-2">
          {/* --- ADD A BACK TO DASHBOARD BUTTON --- */}
          <button
              onClick={() => navigate('/')} // <-- Takes user back to dashboard
              className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
              title="Back to Dashboard"
            >
              <ArrowLeftIcon className="w-4 h-4 mr-1" /> Dashboard
          </button>
          {user && (
            <button
              onClick={handleSignOut}
              // Adjusted padding and margin for better fit
              className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1 flex-shrink-0"
            >
              Sign Out ({user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'User'})
            </button>
          )}
        </div>
         <p className="text-gray-500 text-center">
           Learn English with articles tailored to your interests and level.
         </p>
        {isFreeTierLimitReached && (
          <div className="p-3 bg-yellow-100 border border-yellow-300 text-yellow-800 rounded-lg text-sm text-center">
            You have used all {FREE_LESSON_LIMIT} free lessons for this month. 
            <button onClick={() => navigate('/pricing')} className="font-bold underline ml-1 hover:text-yellow-900">
              Upgrade to Pro
            </button> to search for more.
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Your English Level
          </label>
          <select
            value={inputLevel}
            onChange={(e) => setInputLevel(e.target.value as EnglishLevel)}
            className="w-full p-3 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
          >
            {['Beginner', 'Intermediate', 'Advanced'].map(level => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="topic" className="block text-sm font-medium text-gray-700 mb-2">
            Enter a topic or choose one below:
          </label>
          {/* Use flex-wrap for the input and button on small screens */}
          <div className="flex flex-wrap sm:flex-nowrap gap-2">
            <input
              id="topic"
              type="text"
              value={inputTopic}
              onChange={(e) => setInputTopic(e.target.value.slice(0, 25))}
              placeholder="e.g., AI, Space, Cooking"
              maxLength={25}
              className="flex-grow p-3 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 w-full sm:w-auto" // Ensure input takes full width on small screens
              onKeyDown={(e) => { if (e.key === 'Enter') handleFindArticles() }}
            />
            <button
              onClick={() => handleFindArticles()}
              disabled={isApiLoading || !inputTopic.trim() || isFreeTierLimitReached}
              // Make button full width on small screens, adjust padding
              className="bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition duration-150 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto flex-shrink-0"
              title={isFreeTierLimitReached ? "Free lesson limit reached" : "Find articles for the entered topic"}
            >
              Search
            </button>
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700 mb-3 text-center">Or select a popular topic:</p>
          {/* --- CHANGE HERE: grid-cols-2 by default, md:grid-cols-4 for medium and up --- */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {newsTopics.map((topic) => (
              <button
                key={topic}
                onClick={() => {
                  setInputTopic(topic);
                  handleFindArticles(topic, false); // Pass false for skipNavigation
                }}
                disabled={isApiLoading || isFreeTierLimitReached}
                className="bg-gray-100 text-gray-700 text-sm font-medium py-2 px-1 rounded-lg hover:bg-blue-100 hover:text-blue-700 transition duration-150 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed text-center truncate"
                title={isFreeTierLimitReached ? "Free lesson limit reached" : `Find articles about ${topic}`}
              >
                {topic}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
}

  const renderNewsList = () => (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto bg-white rounded-xl shadow-2xl space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-2 border-b pb-3 mb-3">
        {/* Banner on the left */}
        <img src="/banner.png" alt="StreamLearn Banner Logo" className="h-8 sm:h-10" />
        {isSubscribed && (
          <span className="text-xs font-bold bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded-full shadow-md -ml-2">
            PRO
          </span>
        )}
        {/* Sign out button on the right */}
        <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1 flex-shrink-0"
          >
            Sign Out
        </button>
        {/* Back button and Title on a new line, spanning full width */}
        <div className="w-full flex justify-between items-center mt-2 gap-2">
            <button
              onClick={goToInput}
              className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium flex-shrink-0"
              title="Change Topic"
            >
              <ArrowLeftIcon className="w-4 h-4 mr-1" /> Back
            </button>
            {/* Title - allow wrapping */}
            <h2 className="text-lg sm:text-xl font-bold text-gray-800 text-center flex-grow min-w-0 break-words px-2"> {/* Added break-words and padding */}
              Articles on "{inputTopic}" ({inputLevel})
            </h2>
            {/* Invisible placeholder to balance the flex layout, matching back button space */}
            <div className="flex items-center text-sm font-medium flex-shrink-0 invisible">
                 <ArrowLeftIcon className="w-4 h-4 mr-1" /> Back
            </div>
        </div>
      </div>
      <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
        {isApiLoading && !newsResults.length ? ( // Show loading only if results aren't already displayed
          <LoadingSpinner text="Fetching articles..." />
        ) : newsResults.length === 0 && !isApiLoading ? ( // Show no results message
           <p className="text-center text-gray-500 py-4">No articles found for this topic.</p>
        ) : (
          newsResults.map((article, index) => (
            <div
              key={index}
              className="flex gap-4 p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-blue-50 transition duration-150"
              onClick={() => handleSelectArticle(article, false)}
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
                <p className="text-lg font-semibold text-gray-900 line-clamp-2">
                  {article.title}
                </p>
                <p className="text-sm text-gray-600 line-clamp-2 mt-1">
                  {article.snippet}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Source: {article.source} ({article.date})
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderLessonView = () => {
    // Show loading spinner if lesson is being generated or hasn't loaded from state yet
    if (isLessonGenerating || (!currentLesson && currentView === 'LESSON_VIEW')) {
        return (
             <div className="p-4 sm:p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-2xl space-y-6">
                {/* Header for Loading State */}
                <div className="flex flex-wrap justify-between items-center gap-2 border-b pb-3 mb-3">
                     <img src="/banner.png" alt="StreamLearn Banner Logo" className="h-8 sm:h-10" />
                     {isSubscribed && (
                        <span className="text-sm font-bold text-yellow-600 bg-yellow-100 px-2 py-0.5 rounded-full border border-yellow-500 shadow-sm">
                          PRO
                        </span>
                      )}
                     {user && ( <button onClick={handleSignOut} className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1"> Sign Out </button> )}
                 </div>
                 <button
                    // Go back to search results if possible, otherwise input
                    onClick={() => newsResults.length > 0 ? goToSearch(inputTopic, inputLevel) : goToInput()}
                    className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
                >
                    <ArrowLeftIcon className="w-4 h-4 mr-1" /> Back
                </button>
                <LoadingSpinner text="Generating your lesson, this may take a moment..." />
             </div>
        );
    }

    // Render the lesson content (ensure currentLesson exists here)
    if (!currentLesson) {
       // Fallback case - should ideally not be reached if loading check is correct
       console.error("RenderLessonView: currentLesson is null after loading check.");
       setError("Failed to load lesson data. Please try again.");
       goToInput(); // Navigate back safely
       return null; // Don't render anything
    }

    // Render the lesson content
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-2xl space-y-6">
        {/* --- MODIFIED HEADER --- */}
        <div className="flex flex-wrap justify-between items-center gap-2 border-b pb-3 mb-3">
            {/* Banner on the left */}
            <img src="/banner.png" alt="StreamLearn Banner Logo" className="h-8 sm:h-10" />
            {isSubscribed && (
                <span className="text-sm font-bold text-yellow-600 bg-yellow-100 px-2 py-0.5 rounded-full border border-yellow-500 shadow-sm">
                  PRO
                </span>
              )}
             {/* Action buttons on the right */}
            <div className="flex gap-2 flex-shrink-0">
                 <button
                    onClick={goToInput}
                    className="flex items-center text-indigo-600 hover:text-indigo-800 text-sm font-medium p-1 rounded hover:bg-indigo-50"
                    title="Start New Topic"
                  >
                    <RestartIcon className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">New Topic</span>
                  </button>
                 <button
                    onClick={handleSignOut}
                    className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1"
                  >
                    Sign Out
                 </button>
            </div>
            {/* Back button and Title on a new line, spanning full width */}
            <div className="w-full flex items-center mt-2 gap-2">
                 <button
                    onClick={() => goToSearch(inputTopic, inputLevel)}
                    className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium flex-shrink-0"
                    title="Back to Articles"
                  >
                    <ArrowLeftIcon className="w-4 h-4 mr-1" /> Back
                  </button>
                {/* Title - allow wrapping */}
                 <h2 className="text-xl sm:text-2xl font-bold text-blue-700 text-center flex-grow min-w-0 break-words px-2"> {/* Added break-words and padding */}
                   {currentLesson?.articleTitle || "Generated Lesson"}
                 </h2>
                 {/* Invisible placeholder to balance */}
                 <div className="flex items-center text-sm font-medium flex-shrink-0 invisible">
                      <ArrowLeftIcon className="w-4 h-4 mr-1" /> Back
                 </div>
            </div>
        </div>

        <p className="text-sm text-gray-600">
          <strong>Source:</strong> <a href={currentArticle?.link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{currentArticle?.source}</a> ({currentArticle?.date})
        </p>

        {/* Article Summary Section */}
        <div className="space-y-2 border-l-4 border-blue-500 pl-4 bg-blue-50 p-3 rounded-lg">
          <h3 className="text-xl font-bold text-blue-700">Article Summary</h3>
           {isSummaryAudioLoading && <LoadingSpinner className="w-5 h-5 inline-block mr-2"/>}
           {summaryAudioError && <span className="text-red-600 text-xs ml-2">{summaryAudioError}</span>}

           {/* --- Summary Audio Player MODIFIED --- */}
           {summaryAudioSrc && summaryAudioDuration > 0 && (
             // Reduce gap slightly, keep padding reasonable
             <div className="flex items-center gap-2 bg-gray-100 p-2 rounded border border-gray-300">
                <button
                   onClick={toggleSummaryPlayPause}
                   // Add flex-shrink-0 to prevent button from shrinking excessively
                   className="p-1 text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded flex-shrink-0"
                   aria-label={isSummaryPlaying ? 'Pause summary' : 'Play summary'}
                 >
                   {isSummaryPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />} {/* Slightly smaller icon */}
                 </button>
                 {/* Remove fixed width (w-10), add flex-shrink-0 */}
                 <span className="text-xs font-mono text-gray-600 text-center flex-shrink-0">
                     {formatTime(summaryAudioProgress)}
                 </span>
                 <input
                     type="range"
                     min="0"
                     max={summaryAudioDuration}
                     value={summaryAudioProgress}
                     onChange={handleSeek}
                     // flex-grow allows it to take remaining space, min-w-0 prevents it from causing overflow issues with flex siblings
                     className="flex-grow h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer range-sm dark:bg-gray-700 accent-blue-600 min-w-0"
                 />
                 {/* Remove fixed width (w-10), add flex-shrink-0 */}
                 <span className="text-xs font-mono text-gray-600 text-center flex-shrink-0">
                     {formatTime(summaryAudioDuration)}
                 </span>
             </div>
           )}
          <div className="mt-2 clearfix"> {/* Added clearfix utility */}
             {currentArticle?.image && (
               <img
                 src={currentArticle.image}
                 alt=""
                 // Apply float, margin, and size constraints
                 className="float-left w-20 h-20 sm:w-24 sm:h-24 object-cover rounded mr-4 mb-2" // Added float-left, margins (mr-4, mb-2), responsive size
                 onError={(e) => (e.currentTarget.style.display = 'none')}
               />
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
            Review Vocabulary ({currentLesson?.vocabularyList?.length || 0})
          </button>
          <button
            onClick={() => startActivity('grammar')}
            disabled={!currentLesson?.grammarFocus?.topic}
            className="bg-purple-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-purple-600 transition duration-150 disabled:opacity-50"
          >
            Grammar Quiz (5 Qs)
          </button>
          <button
            onClick={() => startActivity('comprehension')}
            disabled={!currentLesson?.comprehensionQuestions || currentLesson.comprehensionQuestions.length === 0}
            className="bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600 transition duration-150 disabled:opacity-50"
          >
            Comprehension Test ({currentLesson?.comprehensionQuestions?.length || 0})
          </button>
          {/* --- ADD: Writing Practice Button --- */}
          <button
            onClick={() => startActivity('writing')}
            disabled={!currentLesson?.summary}
            className="bg-sky-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-sky-600 transition duration-150 disabled:opacity-50"
          >
            Writing Practice (1 Q)
          </button>
        </div>

        {/* Vocabulary Section */}
        <div className="space-y-3 border-l-4 border-yellow-500 pl-4 bg-yellow-50 p-3 rounded-lg">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-bold text-yellow-700">Vocabulary Builder</h3>
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
                    <p className="text-sm italic text-gray-600 mt-1">Example: "{item.articleExample}"</p>
                  </div>
                  {/* --- START ADD: Save Button --- */}
                  <button
                    onClick={() => handleSaveWord(item)}
                    disabled={isSaved}
                    title={isSaved ? "Saved" : "Save word"}
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
          <h3 className="text-xl font-bold text-purple-700">Grammar Focus: {currentLesson?.grammarFocus?.topic}</h3>
          <p className="text-gray-800 whitespace-pre-wrap"> {/* Added pre-wrap here too */}
             {currentLesson?.grammarFocus?.explanation}
          </p>
        </div>

        {/* Comprehension Section */}
        <div className="space-y-3 border-l-4 border-green-500 pl-4 bg-green-50 p-3 rounded-lg">
          <h3 className="text-xl font-bold text-green-700">Comprehension Questions</h3>
          <ol className="list-decimal list-inside space-y-2">
            {currentLesson?.comprehensionQuestions?.map((q, index) => (
              <li key={index} className="text-gray-800">
                {q}
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  };

  // --- NEW: Render Activity View ---
  const renderActivityView = () => {
    // console.log("Rendering Activity View. State:", activityState); // Keep for debugging if needed

    // --- SIMPLIFIED Loading State check ---
    // Show loading if activityState is null OR if currentData inside it is null
    // (This covers initial load for all types and grammar fetch)
    const isLoadingData = !activityState || !activityState.currentData;

    if (isLoadingData) {
       // Determine loading text more accurately based on activityState existence
       const loadingText = activityState?.type === 'grammar'
                           ? "Generating grammar question..."
                           : activityState // If state exists but data doesn't (initial sync load)
                             ? "Loading..."
                             : "Initializing activity..."; // If state itself is null

        return (
            <div className="p-6 max-w-2xl mx-auto bg-white rounded-xl shadow-2xl space-y-4">
               <LoadingSpinner text={loadingText} />
               {/* Allow quitting */}
               <button onClick={quitActivity} className="block mx-auto mt-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          );
    }

    const { type, index, score, total, currentData, userAnswer, feedback, isSubmitting } = activityState;
     const isFinished = currentData?.finished === true || index >= total;
     if (isFinished) {
        return (
             <div className="p-6 max-w-2xl mx-auto bg-white rounded-xl shadow-2xl space-y-4 text-center">
                 <h2 className="text-2xl font-bold text-blue-700">Activity Complete!</h2>
                 <p className="text-lg text-gray-700">Your score: {score} / {total}</p>
                 <button
                     onClick={quitActivity}
                     className="mt-4 bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 transition duration-150"
                 >
                     Back to Lesson
                 </button>
            </div>
        );
    }


    // Determine background/border color based on feedback
    let feedbackColor = 'border-gray-300'; // Default
    if (feedback.isCorrect === true) feedbackColor = 'border-green-500 bg-green-50';
    if (feedback.isCorrect === false) feedbackColor = 'border-red-500 bg-red-50';

    return (
      <div className={`p-6 max-w-2xl mx-auto bg-white rounded-xl shadow-2xl space-y-4 border-2 ${feedbackColor}`}>
        {/* Header with Progress and Score */}
        <div className="flex justify-between items-center text-sm text-gray-600">
          <span>{type.charAt(0).toUpperCase() + type.slice(1)} Activity</span>
          <span>Score: {score}/{total}</span>
          <span>Question: {index + 1}/{total}</span>
          <button onClick={quitActivity} className="text-xs text-gray-500 hover:text-gray-700">Quit</button>
        </div>
        <hr/>

        {/* --- ADD Audio Error Display --- */}
        {activityAudioError && <ErrorMessage message={activityAudioError} />}

        {/* Activity Content */}
        <div className="mt-4 space-y-4">
          {/* Vocabulary Flashcard */}
          {type === 'vocab' && currentData && ( // Added currentData check
             <div>
               <p className="text-lg font-semibold text-gray-700 mb-2">
                 Definition:
                 {currentData.definition && <SpeakButton text={currentData.definition} />}
               </p>
               <p className="p-3 bg-gray-100 text-gray-900 rounded mb-4">{currentData.definition}</p>

               {/* Conditional Rendering based on Level */}
               {inputLevel === 'Advanced' ? (
                 <>
                   <label htmlFor="vocab-guess" className="block text-sm font-medium text-gray-700 mb-1">Type the word:</label>
                   <input
                     id="vocab-guess"
                     type="text"
                     value={String(userAnswer ?? '')}
                     onChange={(e) => setActivityState(prev => prev ? { ...prev, userAnswer: e.target.value } : null)}
                     disabled={feedback.isCorrect !== null || isSubmitting}
                     className="w-full p-2 border border-gray-300 text-gray-900 rounded disabled:bg-gray-100"
                     onKeyDown={(e) => { if (e.key === 'Enter' && feedback.isCorrect === null) handleSubmitAnswer() }}
                   />
                 </>
               ) : ( // Beginner or Intermediate (Multiple Choice)
                 <>
                    <p className="block text-sm font-medium text-gray-700 mb-2">Choose the correct word:</p>
                    <div className="space-y-2">
                        {currentData.options?.map((option: string) => {
                            let buttonClass = "w-full text-left text-gray-900 p-3 border rounded transition duration-150 ";
                            const isSelected = userAnswer === option;

                            if (feedback.isCorrect !== null) { // After grading
                                if (option === currentData.word) {
                                    buttonClass += "bg-green-300 border-green-400"; // Correct answer
                                } else if (isSelected && !feedback.isCorrect) {
                                    buttonClass += "bg-red-200 border-red-400"; // Incorrect selection
                                } else {
                                    buttonClass += "bg-gray-200 border-gray-300 opacity-70"; // Other options
                                }
                            } else { // Before grading
                                 buttonClass += isSelected
                                                 ? "bg-blue-300 border-blue-400" // Selected
                                                 : "bg-white border-gray-300 hover:bg-gray-50"; // Not selected
                            }

                            return (
                                 <button
                                    key={option}
                                    onClick={() => setActivityState(prev => prev ? { ...prev, userAnswer: option } : null)}
                                    disabled={feedback.isCorrect !== null || isSubmitting}
                                    className={buttonClass}
                                  >
                                    {option}
                                 </button>
                            );
                        })}
                    </div>
                 </>
               )}
             </div>
           )}

          {/* Grammar Quiz */}
          {type === 'grammar' && (
            <div>
              <p className="text-lg font-semibold text-gray-700 mb-3">
                {currentData.question}
                {currentData.question && <SpeakButton text={currentData.question} />}
              </p>
              <div className="space-y-2">
                {currentData.options.map((option: string, i: number) => {
                  const optionLetter = String.fromCharCode(65 + i); // A, B, C, D
                   // Determine button style based on selection and feedback
                   let buttonClass = "text-gray-900 w-full text-left p-3 border rounded transition duration-150 ";
                   const isSelected = userAnswer === optionLetter;

                   if (feedback.isCorrect !== null) { // After grading
                       if (optionLetter === currentData.correctAnswer) {
                           buttonClass += "bg-green-300 border-green-400"; // Correct answer
                       } else if (isSelected && !feedback.isCorrect) {
                           buttonClass += "bg-red-200 border-red-400"; // Incorrect selection
                       } else {
                           buttonClass += "bg-gray-200 border-gray-300 opacity-70"; // Other options
                       }
                   } else { // Before grading
                        buttonClass += isSelected
                                        ? "bg-blue-300 border-blue-400" // Selected
                                        : "bg-white border-gray-300 hover:bg-gray-50"; // Not selected
                   }


                  return (
                    <button
                      key={optionLetter}
                      onClick={() => setActivityState(prev => prev ? { ...prev, userAnswer: optionLetter } : null)}
                      disabled={feedback.isCorrect !== null || isSubmitting}
                      className={buttonClass}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Comprehension Test */}
          {type === 'comprehension' && (
            <div>
              <p className="text-lg font-semibold text-gray-700 mb-3">
                {currentData.question}
                {currentData.question && <SpeakButton text={currentData.question} />}
              </p>
              <textarea
                value={String(userAnswer ?? '')}
                onChange={(e) => setActivityState(prev => prev ? { ...prev, userAnswer: e.target.value } : null)}
                disabled={feedback.isCorrect !== null || isSubmitting}
                rows={4}
                className="w-full p-2 border border-gray-300 text-gray-900 rounded disabled:bg-gray-100"
                placeholder="Type your answer here..."
              />
            </div>
          )}

          {/* --- NEW: Writing Practice --- */}
          {type === 'writing' && currentData && (
            <div>
              <p className="text-lg font-semibold text-gray-700 mb-2">
                Writing Prompt:
                {currentData.prompt && <SpeakButton text={currentData.prompt} />}
              </p>
              <p className="p-3 bg-gray-100 text-gray-900 rounded mb-2">{currentData.prompt}</p>
              {currentData.vocabularyHint && (
                <p className="text-sm text-gray-600 mb-3">
                  Try to use these words: <span className="font-medium">{currentData.vocabularyHint}</span>
                </p>
              )}
              <textarea
                value={String(userAnswer ?? '')}
                onChange={(e) => setActivityState(prev => prev ? { ...prev, userAnswer: e.target.value } : null)}
                disabled={feedback.isCorrect !== null || isSubmitting}
                rows={6}
                className="w-full p-2 border border-gray-300 text-gray-900 rounded disabled:bg-gray-100"
                placeholder="Write your response here..."
              />
            </div>
          )}
        </div>

        {/* Feedback Area */}
        {feedback.message && (
          <div className={`mt-4 p-3 rounded text-sm ${feedback.isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {feedback.message}
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex justify-end gap-3">
          {feedback.isCorrect === null ? ( // Show Submit before grading
            <button
              onClick={handleSubmitAnswer}
              disabled={userAnswer === null || userAnswer === '' || isSubmitting}
              className="bg-blue-600 text-white font-bold py-2 px-5 rounded-lg hover:bg-blue-700 transition duration-150 disabled:opacity-50"
            >
              {isSubmitting ? <LoadingSpinner className="w-5 h-5 inline-block"/> : "Submit"}
            </button>
          ) : ( // Show Next/Finish after grading
            <button
              onClick={handleNextQuestion}
              className="bg-gray-600 text-white font-bold py-2 px-5 rounded-lg hover:bg-gray-700 transition duration-150"
            >
             {index + 1 >= total ? "Finish" : "Next"}
            </button>
          )}
        </div>
      </div>
    );
  };

  // --- Main return ---
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100 font-sans"> {/* Changed font */}
      <div className="w-full">
        {/* Global error bar - always show if error exists */}
        {error && <ErrorMessage message={error} />}

        {/* --- MODIFIED: Updated Loading Check --- */}
        {(authState === 'LOADING' || (authState === 'SIGNED_IN' && isSubLoading)) && (
             <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <LoadingSpinner text={authState === 'LOADING' ? "Initializing..." : "Loading your account..."} />
             </div>
        )}

        {/* Sign in view */}
        {authState === 'SIGNED_OUT' && (
             <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100 font-sans">
                 <div className="p-6 max-w-sm mx-auto bg-white rounded-xl shadow-2xl space-y-4 text-center">
                   <img src="/banner.png" alt="StreamLearn Banner Logo" className="h-10 mx-auto mb-4" />
                   <h2 className="text-xl font-semibold text-gray-700">Welcome to StreamLearn AI</h2>
                   <p className="text-gray-600">Please sign in with Google to continue.</p>
                   {/* Show auth error here specifically */}
                   {error && currentView === 'SIGN_OUT' && <ErrorMessage message={error} />}
                   <button
                      onClick={signInWithGoogle}
                      disabled={isApiLoading} // Disable if auth is in progress
                      className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 transition duration-150 shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                   >
                      <svg className="w-5 h-5" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path><path fill="none" d="M0 0h48v48H0z"></path></svg>
                      Sign In with Google
                   </button>
                 </div>
             </div>
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