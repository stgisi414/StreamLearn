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
import { getFirestore, doc, setDoc, Timestamp } from 'firebase/firestore';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ErrorMessage } from './components/ErrorMessage';
import { RestartIcon } from './components/icons/RestartIcon';
import { ArrowLeftIcon } from './components/icons/ArrowLeftIcon';
import { VolumeUpIcon } from './components/icons/VolumeUpIcon';
import { Lesson, Article, NewsResult, EnglishLevel, LessonResponse } from './types';

// --- Configuration Variables ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, // Use the correct value from .env
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID // Optional
};

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
type AppView = 'LOADING' | 'SIGN_OUT' | 'INPUT' | 'NEWS_LIST' | 'LESSON_VIEW' | 'ACTIVITY'; // Added ACTIVITY view

// Type for activity state
type ActivityType = 'vocab' | 'grammar' | 'comprehension';
interface ActivityState {
  type: ActivityType;
  index: number; // Current question/word index
  score: number;
  total: number;
  // Data for the current step (e.g., definition, grammar question/options, comprehension question)
  currentData: any;
  userAnswer: string | number | null; // User's input/selection
  feedback: { isCorrect: boolean | null; message: string };
  isSubmitting: boolean; // Flag for API call loading
}

const App: React.FC = () => {
  // --- Auth State ---
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<'LOADING' | 'SIGNED_OUT' | 'SIGNED_IN'>('LOADING');

  // --- View State (derived from URL and authState) ---
  const [currentView, setCurrentView] = useState<AppView>('LOADING');

  // --- Global Error ---
  const [error, setError] = useState<string | null>(null);

  // --- Loading State (for API calls) ---
  const [isApiLoading, setIsApiLoading] = useState(false);

  // --- Activity state ---
  const [activityState, setActivityState] = useState<ActivityState | null>(null);

  // --- NEW: Audio State ---
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null); // To manage playback

  // --- Persistent State ---
  const [inputTopic, setInputTopic] = useLocalStorageState<string>('streamlearn_topic', '');
  const [inputLevel, setInputLevel] = useLocalStorageState<EnglishLevel>('streamlearn_level', 'Intermediate');
  const [newsResults, setNewsResults] = useLocalStorageState<NewsResult[]>('streamlearn_results', []);
  const [currentArticle, setCurrentArticle] = useLocalStorageState<Article | null>('streamlearn_article', null);
  const [currentLesson, setCurrentLesson] = useLocalStorageState<Lesson | null>('streamlearn_lesson', null);

  // --- Static Data ---
  const newsTopics: string[] = [
    "Technology", "Business", "World News", "US Politics", "Health", "Science",
    "Environment", "Sports", "Entertainment", "Finance", "AI", "Space",
    "Climate Change", "Cybersecurity", "Electric Vehicles", "Global Economy"
  ];

  // --- Firebase Service Memos ---
  const db = useMemo(() => getFirestore(app), []);
  const auth = useMemo(() => getAuth(app), []);

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
      } catch (e) {
        console.warn("Could not connect auth emulator (might already be connected or emulator not running).", e);
      }
    }
  }, [auth]); // Run only when auth instance changes

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
    navigate('/');
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
  }, [authState, user, authenticatedFetch, inputTopic, inputLevel, setNewsResults, setError, goToSearch, goToInput, setCurrentView]); // Added dependencies

  const handleSelectArticle = useCallback(async (article: Article, skipNavigation: boolean = false) => {
    console.log("handleSelectArticle called for:", article.link); // Add log
    if (authState !== 'SIGNED_IN' || !user) {
        setError("Please sign in first.");
        return;
    }

    // --- ADD CHECK FOR EXISTING LESSON ---
    // If we are navigating (not skipping) AND the clicked article matches the current one AND a lesson exists...
    if (!skipNavigation && currentArticle?.link === article.link && currentLesson) {
        console.log("Clicked same article, lesson exists. Navigating without refetch.");
        goToLesson(article); // Just navigate to the URL, handleUrlChange will show existing lesson
        return; // Stop execution here
    }
    // --- END CHECK ---

    // --- Proceed with fetching/generating if it's a new article or no lesson exists ---
    console.log("Proceeding to fetch/generate lesson.");
    setIsApiLoading(true);
    setError(null);

    // Clear the *old* lesson only if we are selecting a *new* article
    if (!skipNavigation && currentArticle?.link !== article.link) {
      console.log("Clearing previous lesson for new article selection.");
      setCurrentLesson(null);
    }

    // Navigate or set view
    if (!skipNavigation) {
      goToLesson(article); // Sets currentArticle & navigates (calls handleUrlChange)
    } else {
      setCurrentView('LESSON_VIEW');
    }

    try {
      // --- Fetch only if lesson is null ---
      // This condition prevents refetching on refresh if lesson is already in localStorage
      let lessonToSave = currentLesson;
      if (!lessonToSave) {
          console.log("No current lesson found, calling API...");
          const responseData = await authenticatedFetch('createLesson', {
            articleUrl: article.link,
            level: inputLevel,
            title: article.title,
            snippet: article.snippet || ''
          });

          if (responseData.success && responseData.lesson) {
            lessonToSave = responseData.lesson as Lesson;
            setCurrentLesson(lessonToSave); // Save the newly fetched lesson
          } else {
             setError(responseData.error || responseData.details || "Lesson generation failed.");
             goToInput(); // Go back to safety
             setIsApiLoading(false); // Make sure loading stops on error
             return; // Stop execution
          }
      } else {
         console.log("Lesson already exists in state, skipping API call.");
      }
      // --- End fetch only if needed ---

      // Save lesson to Firestore (now uses lessonToSave)
      if (lessonToSave) {
          const lessonDocId = `${user.uid}-${Date.now()}`; // Use a fresh timestamp for saving
          await setDoc(doc(db, `users/${user.uid}/lessons`, lessonDocId), {
              userId: user.uid,
              topic: inputTopic,
              level: inputLevel,
              articleUrl: article.link,
              lessonData: lessonToSave, // Use the fetched or existing lesson
              summarySource: (lessonToSave as any).summarySource || (currentLesson as any)?.summarySource || 'unknown', // Try to get source if available
              createdAt: Timestamp.now()
          });
          console.log("Lesson saved/resaved to Firestore");
      }

    } catch (e) {
      console.error("Error in handleSelectArticle API call block:", e);
      setError(`Failed to process lesson: ${(e as Error).message}`); // More specific error
      goToInput(); // Go back to safety on error
    } finally {
        setIsApiLoading(false);
    }
  }, [
      inputLevel, authState, user, db, authenticatedFetch,
      setCurrentArticle, currentLesson, setCurrentLesson, // Added currentLesson
      setError, goToLesson, goToInput, inputTopic,
      setCurrentView, setIsApiLoading, currentArticle // Added currentArticle
  ]); // Added dependencies

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
    } else { // Default path '/'
      nextView = 'INPUT';
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

  }, [
    // Keep all dependencies here
    authState, currentLesson, currentArticle, newsResults, inputTopic, inputLevel, isApiLoading,
    setCurrentView, setInputTopic, setInputLevel, setError, setNewsResults, setCurrentArticle, setCurrentLesson, // Added missing setters
    handleSelectArticle, handleFindArticles, goToInput // Ensure these are stable (defined with useCallback)
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
    if(authState !== 'LOADING') {
        const { pathname, search } = window.location;
        handleUrlChangeRef.current(pathname, new URLSearchParams(search));
    }

    return () => {
        window.removeEventListener('popstate', handlePopState);
    };
  }, [authState]); // Rerun only when authState changes

  // --- Auth state listener ---
   useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setAuthState('SIGNED_IN');
        // Let the useEffect above handle the initial URL check based on authState change
        setError(null);
      } else {
        setUser(null);
        setAuthState('SIGNED_OUT');
        setCurrentView('SIGN_OUT');
      }
    });
    return () => unsubscribe();
  }, [auth, setCurrentView]); // Added setCurrentView


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
    setError(null); // Clear global errors
    let totalItems = 0;
    if (type === 'vocab') totalItems = currentLesson.vocabularyList.length;
    if (type === 'grammar') totalItems = 5; // Let's aim for 5 grammar questions
    if (type === 'comprehension') totalItems = currentLesson.comprehensionQuestions.length;

    if (totalItems === 0) {
        setError(`No ${type} items available for this lesson.`);
        return;
    }

    setActivityState({
      type: type,
      index: 0,
      score: 0,
      total: totalItems,
      currentData: null, // Will be loaded by useEffect
      userAnswer: null,
      feedback: { isCorrect: null, message: '' },
      isSubmitting: false,
    });
    setCurrentView('ACTIVITY'); // Switch view
  };

  const quitActivity = () => {
    setActivityState(null);
    goToLesson(currentArticle!); // Go back to the lesson URL
  };

  // Effect to load data for the current activity step
  useEffect(() => {
    // Ensure we are in the activity view and have necessary state
    if (currentView !== 'ACTIVITY' || !activityState || !currentLesson) {
        console.log("Activity useEffect: Bailing early", { currentView, activityState, currentLesson });
        return;
    }

    const { type, index, total } = activityState;

    // Check if activity is finished
    if (index >= total) {
        console.log("Activity finished, index >= total.");
        // Set view to finished state or trigger quit
         setActivityState(prev => prev ? ({ ...prev, currentData: { finished: true } }) : null); // Mark as finished
        return;
    }

    // Reset answer/feedback for the new step BEFORE loading/generating data
    setActivityState(prev => prev ? ({
         ...prev,
         userAnswer: null,
         feedback: { isCorrect: null, message: '' },
         // Keep currentData null only if we need to fetch (grammar)
         currentData: type === 'grammar' ? null : prev.currentData,
         isSubmitting: type === 'grammar' // Set submitting true only for grammar fetch
     }) : null);


    console.log(`Activity useEffect: Loading data for type=${type}, index=${index}`);

    let dataForStep: any = null;

    try { // Wrap data access in try-catch for safety
        if (type === 'vocab') {
            if (index < currentLesson.vocabularyList.length) {
                const vocabItem = currentLesson.vocabularyList[index];
                // --- ADD VALIDATION ---
                if (vocabItem && typeof vocabItem.definition === 'string') {
                    dataForStep = vocabItem; // Contains word, definition
                } else {
                    console.error(`Error: Vocab item at index ${index} is invalid or missing definition.`, vocabItem);
                    setError(`Error loading vocabulary item #${index + 1}.`);
                    quitActivity(); // Exit activity on bad data
                    return;
                }
                // --- END VALIDATION ---
            }
        } else if (type === 'comprehension') {
            if (index < currentLesson.comprehensionQuestions.length) {
                const questionText = currentLesson.comprehensionQuestions[index];
                // --- ADD VALIDATION ---
                if (typeof questionText === 'string' && questionText.trim() !== '') {
                    dataForStep = { question: questionText, summary: currentLesson.summary };
                } else {
                     console.error(`Error: Comprehension question at index ${index} is invalid or empty.`, questionText);
                     setError(`Error loading comprehension question #${index + 1}.`);
                     quitActivity(); // Exit activity on bad data
                     return;
                }
                // --- END VALIDATION ---
            }
        } else if (type === 'grammar') {
            // Grammar data is fetched asynchronously
            console.log("Activity useEffect: Fetching grammar question...");
            authenticatedFetch('handleActivity', {
                activityType: 'grammar_generate',
                payload: {
                topic: currentLesson.grammarFocus.topic,
                explanation: currentLesson.grammarFocus.explanation,
                level: inputLevel
                }
            })
            .then(data => {
                 // --- ADD VALIDATION ---
                if (data && typeof data.question === 'string' && data.options && Array.isArray(data.options)) {
                    setActivityState(prev => prev ? ({ ...prev, currentData: data, isSubmitting: false }) : null);
                    console.log("Grammar question received:", data);
                } else {
                     console.error("Error: Invalid grammar data received from backend.", data);
                     setError("Failed to load a valid grammar question.");
                     setActivityState(prev => prev ? ({ ...prev, isSubmitting: false }) : null); // Stop loading
                     quitActivity();
                }
                 // --- END VALIDATION ---
            })
            .catch(err => {
                console.error("Error fetching grammar question:", err);
                setError(`Failed to generate grammar question: ${err.message}`);
                setActivityState(prev => prev ? ({ ...prev, isSubmitting: false }) : null);
                quitActivity();
            });
            return; // Return early for async grammar fetch
        }

        // --- Update state if data was found synchronously ---
        if (dataForStep) {
             console.log("Setting currentData for sync step:", dataForStep);
            setActivityState(prev => prev ? ({ ...prev, currentData: dataForStep, isSubmitting: false }) : null); // Ensure isSubmitting is false
        } else {
             // This case might happen if index is out of bounds but wasn't caught earlier
             console.warn(`Activity useEffect: No data found for type=${type}, index=${index}. Exiting activity.`);
             setError(`Could not load item #${index + 1}.`);
             quitActivity();
        }
    } catch (dataAccessError) {
         console.error(`Error accessing lesson data for type=${type}, index=${index}:`, dataAccessError);
         setError("An error occurred while preparing the activity.");
         quitActivity();
    }

  }, [currentView, activityState?.type, activityState?.index]);

  const handleSubmitAnswer = async () => {
    if (!activityState || activityState.userAnswer === null || activityState.feedback.isCorrect !== null) return; // Don't submit if already graded or no answer

    setActivityState(prev => prev ? ({ ...prev, isSubmitting: true }) : null);
    setError(null);

    const { type, currentData, userAnswer } = activityState;
    let requestPayload: any = {};
    let gradeType: string = type; // Default to type

    try {
      if (type === 'vocab') {
        requestPayload = { word: currentData.word, definition: currentData.definition, userAnswer: String(userAnswer) };
      } else if (type === 'grammar') {
        gradeType = 'grammar_grade'; // Use specific grading type
        requestPayload = {
          question: currentData.question,
          options: currentData.options,
          correctAnswer: currentData.correctAnswer,
          userAnswer: String(userAnswer) // Send selected letter
        };
      } else if (type === 'comprehension') {
        requestPayload = {
          question: currentData.question,
          summary: currentData.summary,
          userAnswer: String(userAnswer)
        };
      }

      const result = await authenticatedFetch('handleActivity', {
        activityType: gradeType,
        payload: requestPayload
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

   // --- NEW: Text-to-Speech Handler ---
  const handleTextToSpeech = async (text: string | undefined | null) => {
    console.log("handleTextToSpeech called with text:", text);

    if (!text || isAudioLoading) {
        console.log("handleTextToSpeech returning early. Reason:", !text ? "No text" : "Audio loading");
        return; // Don't run if no text or already loading
    }
    if (currentAudioRef.current) {
        currentAudioRef.current.pause(); // Stop previous audio if playing
        currentAudioRef.current = null;
    }

    setIsAudioLoading(true);
    setAudioError(null);
    setError(null); // Clear main error

    try {
        const response = await authenticatedFetch('textToSpeech', { text });
        if (response.audioContent) {
            const audioData = `data:audio/mp3;base64,${response.audioContent}`;
            const audio = new Audio(audioData);
            currentAudioRef.current = audio; // Store reference
            audio.play().catch(e => {
                console.error("Audio play failed:", e);
                setAudioError("Could not play audio.");
            });
            // Handle audio ending or error during playback
            audio.onended = () => { currentAudioRef.current = null; };
            audio.onerror = () => {
                console.error("Audio element error");
                setAudioError("Error playing audio file.");
                currentAudioRef.current = null;
            };
        } else {
            throw new Error("Backend did not return audio content.");
        }
    } catch (e) {
        console.error("TTS Fetch Error:", e);
        setAudioError(`Failed to get audio: ${(e as Error).message}`);
    } finally {
        setIsAudioLoading(false);
    }
  };

  // --- Render Functions ---

  const renderInput = () => (
    <div className="p-6 max-w-lg mx-auto bg-white rounded-xl shadow-2xl space-y-6">
      <div className="flex justify-between items-center">
        <img src="/banner.png" alt="StreamLearn Banner Logo" className="h-10" />
        {user && (
          <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium ml-4 flex-shrink-0"
          >
            Sign Out ({user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'User'})
          </button>
        )}
      </div>
       <p className="text-gray-500 text-center">
         Learn English with articles tailored to your interests and level.
       </p>
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
        <div className="flex gap-2">
          <input
            id="topic"
            type="text"
            value={inputTopic}
            onChange={(e) => setInputTopic(e.target.value)}
            placeholder="e.g., AI, Space, Cooking"
            className="flex-grow p-3 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
            onKeyDown={(e) => { if (e.key === 'Enter') handleFindArticles() }}
          />
          <button
            onClick={() => handleFindArticles()}
            disabled={isApiLoading || !inputTopic.trim()}
            className="bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition duration-150 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            title="Find articles for the entered topic"
          >
            Search
          </button>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700 mb-3 text-center">Or select a popular topic:</p>
        <div className="grid grid-cols-4 gap-2">
          {newsTopics.map((topic) => (
            <button
              key={topic}
              onClick={() => {
                setInputTopic(topic);
                handleFindArticles(topic, false); // Pass false for skipNavigation
              }}
              disabled={isApiLoading}
              className="bg-gray-100 text-gray-700 text-sm font-medium py-2 px-1 rounded-lg hover:bg-blue-100 hover:text-blue-700 transition duration-150 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed text-center truncate"
              title={`Find articles about ${topic}`}
            >
              {topic}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderNewsList = () => (
    <div className="p-6 max-w-3xl mx-auto bg-white rounded-xl shadow-2xl space-y-4">
      <div className="flex justify-between items-center">
        <button
          onClick={goToInput}
          className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-1" /> Change Topic
        </button>
        <h2 className="text-xl font-bold text-gray-800 text-center flex-grow mx-2 truncate">
          Articles on "{inputTopic}" ({inputLevel})
        </h2>
         <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Sign Out
          </button>
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
    if (isApiLoading || !currentLesson) {
        return (
             <div className="p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-2xl space-y-6">
                <button
                    onClick={() => goToSearch(inputTopic, inputLevel)}
                    className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
                >
                    <ArrowLeftIcon className="w-4 h-4 mr-1" /> Back to Articles
                </button>
                <LoadingSpinner text="Generating your lesson, this may take a moment..." />
             </div>
        );
    }

    // Render the lesson content
    return (
      <div className="p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-2xl space-y-6">
        <div className="flex justify-between items-center border-b pb-4 gap-4">
          <button
            onClick={() => goToSearch(inputTopic, inputLevel)}
            className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium flex-shrink-0"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" /> Back
          </button>
          <h2 className="text-2xl font-extrabold text-blue-700 text-center flex-grow min-w-0 truncate">
            {currentLesson?.articleTitle || "Generated Lesson"}
          </h2>
          <button
            onClick={goToInput}
            className="flex items-center text-indigo-600 hover:text-indigo-800 text-sm font-medium flex-shrink-0"
            title="Start New Topic"
          >
            <RestartIcon className="w-4 h-4 mr-1" /> New Topic
          </button>
        </div>

        <p className="text-sm text-gray-600">
          <strong>Source:</strong> <a href={currentArticle?.link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{currentArticle?.source}</a> ({currentArticle?.date})
        </p>

        {/* Article Summary Section */}
        <div className="space-y-2 border-l-4 border-blue-500 pl-4 bg-blue-50 p-3 rounded-lg">
          <h3 className="text-xl font-bold text-blue-700">Article Summary</h3>
          <div className="flex flex-col sm:flex-row gap-4"> {/* Stack on small screens */}
            {currentArticle?.image && (
              <img
                src={currentArticle.image}
                alt=""
                className="w-20 h-20 object-cover rounded flex-shrink-0"
                onError={(e) => (e.currentTarget.style.display = 'none')}
              />
            )}
            <p className="text-gray-800 whitespace-pre-wrap flex-grow min-w-0">
              {currentLesson?.summary}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t pt-4">
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
        </div>

        {/* Vocabulary Section */}
        <div className="space-y-3 border-l-4 border-yellow-500 pl-4 bg-yellow-50 p-3 rounded-lg">
          <h3 className="text-xl font-bold text-yellow-700">Vocabulary Builder</h3>
          <ul className="space-y-3">
            {currentLesson?.vocabularyList?.map((item, index) => (
              <li key={index} className="text-gray-800">
                <strong className="text-yellow-900">{item.word}:</strong> {item.definition}
                <p className="text-sm italic text-gray-600 mt-1">Example: "{item.articleExample}"</p>
              </li>
            ))}
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
    
    // Helper Button Component for TTS
    const SpeakButton = ({ text }: { text: string | undefined | null }) => (
        <button
            onClick={() => {
                console.log("SpeakButton clicked. Text:", text); // Log click and text
                handleTextToSpeech(text);
            }}
            disabled={isAudioLoading || !text}
            // --- ADD cursor-pointer ---
            className="ml-2 p-1 text-gray-500 hover:text-blue-600 disabled:opacity-50 inline-block align-middle cursor-pointer disabled:cursor-not-allowed" // Added cursor-pointer and disabled:cursor-not-allowed
            title="Read aloud"
        >
            {isAudioLoading ? (
                 <LoadingSpinner className="w-4 h-4 inline-block" />
            ) : (
                 <VolumeUpIcon className="w-5 h-5" />
            )}
        </button>
    );

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
        {audioError && <ErrorMessage message={audioError} />}

        {/* Activity Content */}
        <div className="mt-4 space-y-4">
          {/* Vocabulary Flashcard */}
          {type === 'vocab' && (
            <div>
              <p className="text-lg font-semibold text-gray-700 mb-2">
                Definition:
                {currentData.definition && <SpeakButton text={currentData.definition} />}
              </p>
              <p className="p-3 bg-gray-100 text-gray-900 rounded mb-4">{currentData.definition}</p>
              <label htmlFor="vocab-guess" className="block text-sm font-medium text-gray-700 mb-1">Guess the word:</label>
              <input
                id="vocab-guess"
                type="text"
                value={String(userAnswer ?? '')}
                onChange={(e) => setActivityState(prev => prev ? { ...prev, userAnswer: e.target.value } : null)}
                disabled={feedback.isCorrect !== null || isSubmitting}
                className="w-full p-2 border border-gray-300 text-gray-900 rounded disabled:bg-gray-100"
                onKeyDown={(e) => { if (e.key === 'Enter' && feedback.isCorrect === null) handleSubmitAnswer() }}
              />
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

        {/* Auth loading */}
        {authState === 'LOADING' && (
             <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <LoadingSpinner text="Initializing..." />
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

        {/* Main app view, rendered based on URL-driven currentView */}
        {authState === 'SIGNED_IN' && (
            <>
                {currentView === 'INPUT' && renderInput()}
                {currentView === 'NEWS_LIST' && renderNewsList()}
                {currentView === 'LESSON_VIEW' && renderLessonView()}
                {currentView === 'ACTIVITY' && renderActivityView()}
                {/* General loading state if view hasn't resolved after sign in */}
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