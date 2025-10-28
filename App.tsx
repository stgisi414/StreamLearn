import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  // Remove signInAnonymously, signInWithCustomToken (if not needed for AI Studio)
  onAuthStateChanged,
  User,
  // Add these imports
  GoogleAuthProvider,
  signInWithPopup,
  signOut, // Add signOut for logout functionality
  connectAuthEmulator
} from 'firebase/auth';
import { getFirestore, doc, setDoc, Timestamp } from 'firebase/firestore';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ErrorMessage } from './components/ErrorMessage';
import { RestartIcon } from './components/icons/RestartIcon';
import { ArrowLeftIcon } from './components/icons/ArrowLeftIcon';
import { Lesson, Article, NewsResult, EnglishLevel, LessonResponse } from './types';

// --- Configuration Variables ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  // measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID // Optional
};

// Check if Firebase app is already initialized to avoid errors
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (e) {
  console.warn("Firebase App already initialized potentially.");
  // Consider using getApps() and getApp() if multiple initializations are possible
}

// Function to get the Function Base URL (no changes needed here)
function getFunctionBaseUrl(): string {
  const isDevelopment = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (isDevelopment) {
    return "/api";
  }
  const hostedFullUrl = (window as any).functionBaseUrl;
  if (typeof hostedFullUrl === 'string' && hostedFullUrl.length > 0) {
    const base = hostedFullUrl.split('/fetchNews')[0];
    return base || hostedFullUrl;
  }
  return "/api";
}
const BASE_FUNCTION_URL = getFunctionBaseUrl();

// --- Main App Component ---
type AppState = 'LOADING' | 'INPUT' | 'NEWS_LIST' | 'LESSON_VIEW' | 'ERROR';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<'LOADING' | 'SIGNED_OUT' | 'SIGNED_IN'>('LOADING'); // Updated auth states
  const [appState, setAppState] = useState<AppState>('INPUT');
  const [error, setError] = useState<string | null>(null);

  const [inputTopic, setInputTopic] = useState('');
  const [inputLevel, setInputLevel] = useState<EnglishLevel>('Intermediate');

  const [newsResults, setNewsResults] = useState<NewsResult[]>([]);
  const [currentArticle, setCurrentArticle] = useState<Article | null>(null);
  const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);

  // --- Topic Suggestions ---
  const newsTopics: string[] = [
    "Technology", "Business", "World News", "US Politics", "Health", "Science",
    "Environment", "Sports", "Entertainment", "Finance", "AI", "Space",
    "Climate Change", "Cybersecurity", "Electric Vehicles", "Global Economy"
  ];

  const db = useMemo(() => getFirestore(), []); // Get Firestore from default app

  // --- Authentication Logic ---
  const auth = useMemo(() => getAuth(), []); // Get Auth from default app

  // Connect emulator if developing locally
  useEffect(() => {
    const isDevelopment = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isDevelopment) {
      try {
        connectAuthEmulator(auth, "http://localhost:9099");
        console.log("Auth emulator connected.");
      } catch (e) {
        console.warn("Could not connect auth emulator, might already be connected.", e);
      }
    }
  }, [auth]);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setAuthState('SIGNED_IN');
        setAppState('INPUT'); // Go to input screen once signed in
        setError(null); // Clear errors on successful sign-in
      } else {
        setUser(null);
        setAuthState('SIGNED_OUT');
        setAppState('INPUT'); // Reset app state on sign out
      }
    });
    return () => unsubscribe();
  }, [auth]);

  // Google Sign-In Handler
  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      setAuthState('LOADING'); // Show loading while popup is open
      await signInWithPopup(auth, provider);
      // onAuthStateChanged will handle setting user and SIGNED_IN state
    } catch (e) {
      console.error("Google Sign-In Error:", e);
      setError(`Google Sign-In failed: ${(e as Error).message}`);
      setAuthState('SIGNED_OUT'); // Revert state on failure
    }
  };

  // Sign Out Handler
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      // onAuthStateChanged will handle setting user to null and SIGNED_OUT state
    } catch (e) {
      console.error("Sign Out Error:", e);
      setError(`Sign out failed: ${(e as Error).message}`);
    }
  };


  // --- Core Fetch Helper (Modified error handling slightly) ---
  const authenticatedFetch = useCallback(async (functionName: string, body: any) => {
    if (!user) {
        setError("You must be signed in to perform this action."); // User-facing error
        throw new Error("Authentication failed: User token missing."); // Internal error
    }

    let idToken;
    try {
      idToken = await user.getIdToken(true); // Force refresh token if needed
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
            try {
                errorData = JSON.parse(errorText);
            } catch { /* Ignore if not JSON */ }
            const errorMessage = errorData.error || errorData.details || `Request failed with status ${response.status}: ${errorText.substring(0, 100)}`;
            throw new Error(errorMessage);
        }

        return response.json();
    } catch (e) {
        console.error(`Fetch error in ${functionName}:`, e); // Log specific function error
        setError(`API request failed: ${(e as Error).message}`); // Set user-facing error
        throw e; // Re-throw for calling function's catch block
    }
  }, [user]); // Removed BASE_FUNCTION_URL as it's stable

  // --- Function Call Logic: Find Articles (Error handling update) ---
  const handleFindArticles = useCallback(async (topicOverride?: string) => {
    // Use the override if provided, otherwise use the state
    const topicToSearch = topicOverride ?? inputTopic;

    if (topicToSearch.trim() === '') {
      setError("Please enter a topic of interest.");
      return;
    }
    if (authState !== 'SIGNED_IN' || !user) {
        setError("Please sign in first.");
        return;
    }

    setAppState('LOADING');
    setError(null);
    setNewsResults([]);

    try {
      // Use topicToSearch in the API call
      const results = await authenticatedFetch('fetchNews', {
        query: topicToSearch,
        languageCode: 'en'
      }) as NewsResult[];

      if (!results || results.length === 0) {
        setError(`No current news articles found for "${topicToSearch}".`);
        setAppState('INPUT');
      } else {
        setNewsResults(results.filter(r => r.title && r.link));
        setAppState('NEWS_LIST');
      }
    } catch (e) {
      setAppState('INPUT');
    }
  // Update dependencies: remove inputTopic, add user and authenticatedFetch
  }, [authState, user, authenticatedFetch]);

  // --- Function Call Logic: Create Lesson (Error handling update and Firestore logic) ---
  const handleSelectArticle = useCallback(async (article: NewsResult) => {
    if (authState !== 'SIGNED_IN' || !user) { // Check for signed-in user
        setError("Please sign in first.");
        return;
    }

    setAppState('LOADING');
    setError(null);
    setCurrentArticle(article); // Keep the original article details
    setCurrentLesson(null);

    try {
      const responseData = await authenticatedFetch('createLesson', {
        articleUrl: article.link,
        level: inputLevel,
        // --- ADD title and snippet ---
        title: article.title,
        snippet: article.snippet
      });

      // --- REMOVE specific paywall catch logic here ---
      // The backend now handles this internally and should always return success:true with a lesson
      // if it succeeds, or throw an error (which sets the error state via authenticatedFetch) if both summary attempts fail.

      if (responseData.success && responseData.lesson) {
        const lesson = responseData.lesson as Lesson;
        setCurrentLesson(lesson);
        setAppState('LESSON_VIEW');
        logger.info("Lesson created successfully. Summary source:", responseData.summarySource); // Log summary source

        // Firestore saving logic remains the same
        const lessonDocId = `${user.uid}-${Date.now()}`;
        await setDoc(doc(db, `users/${user.uid}/lessons`, lessonDocId), {
            userId: user.uid,
            topic: inputTopic,
            level: inputLevel,
            articleUrl: article.link,
            lessonData: lesson,
            summarySource: responseData.summarySource, // Optionally save source
            createdAt: Timestamp.now()
        });
        console.log("Lesson saved to Firestore");

      } else {
         // This path might occur if the backend returns success: false for some other reason
         setError(responseData.error || responseData.details || "Lesson generation failed: Unknown backend issue.");
         setAppState('NEWS_LIST');
      }

    } catch (e) {
      // General error handling (setError is likely already set by authenticatedFetch)
      console.error("Error during handleSelectArticle:", e);
      setAppState('NEWS_LIST'); // Go back to the list on any error
    }
  }, [inputLevel, authState, user, db, inputTopic, authenticatedFetch]);


  // --- Render Logic ---

  // Loading Screen for Auth
  if (authState === 'LOADING') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <LoadingSpinner text="Initializing..." />
      </div>
    );
  }

  // Sign-In Screen
  if (authState === 'SIGNED_OUT') {
    return (
       <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100 font-inter">
         <div className="p-6 max-w-sm mx-auto bg-white rounded-xl shadow-2xl space-y-4 text-center">
             <h2 className="text-2xl font-bold text-blue-700">Welcome to StreamLearn AI</h2>
             <p className="text-gray-600">Please sign in with Google to continue.</p>
             {error && <ErrorMessage message={error} />}
             <button
                onClick={signInWithGoogle}
                className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 transition duration-150 shadow-lg flex items-center justify-center gap-2"
             >
                {/* Basic Google Icon SVG - Replace with a better one if needed */}
                <svg className="w-5 h-5" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path><path fill="none" d="M0 0h48v48H0z"></path></svg>
                Sign In with Google
             </button>
         </div>
       </div>
    );
  }

  // Main App Content (render functions remain largely the same, but add sign out)
  const renderInput = () => (
    <div className="p-6 max-w-lg mx-auto bg-white rounded-xl shadow-2xl space-y-6">
      {/* --- Header with Sign Out --- */}
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-extrabold text-blue-700">
          StreamLearn AI
        </h2>
        {user && (
          <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Sign Out ({user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'User'})
          </button>
        )}
      </div>
       <p className="text-gray-500 text-center">
         Learn English with articles tailored to your interests and level.
       </p>

      {/* --- Level Selection --- */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Your English Level
        </label>
        <select
          value={inputLevel}
          onChange={(e) => setInputLevel(e.target.value as EnglishLevel)}
          className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
        >
          {['Beginner', 'Intermediate', 'Advanced'].map(level => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
      </div>

      {/* --- Topic Input --- */}
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
            className="flex-grow p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            onClick={() => handleFindArticles()} // Call without argument
            disabled={appState === 'LOADING' || !inputTopic.trim()}
            className="..." // Keep existing classes
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
               setInputTopic(topic); // Update state for UI consistency
               handleFindArticles(topic); // Pass the topic directly
             }}
             disabled={appState === 'LOADING'}
             className="..." // Keep existing classes
             title={`Find articles about ${topic}`}
           >
             {topic}
           </button>
         ))}
       </div>
      </div>
    </div>
  );

  // renderNewsList and renderLessonView remain the same as before

  const renderNewsList = () => (
    <div className="p-6 max-w-3xl mx-auto bg-white rounded-xl shadow-2xl space-y-4">
      <div className="flex justify-between items-center">
        <button
          onClick={() => setAppState('INPUT')}
          className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-1" /> Change Topic
        </button>
        <h2 className="text-xl font-bold text-gray-800">
          Articles on "{inputTopic}" ({inputLevel})
        </h2>
         <button // Sign out button also here for convenience
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Sign Out
          </button>
      </div>

      <div className="space-y-3 max-h-[70vh] overflow-y-auto">
        {newsResults.map((article, index) => (
          <div
            key={index}
            className="p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-blue-50 transition duration-150"
            onClick={() => handleSelectArticle(article)}
          >
            <p className="text-lg font-semibold text-gray-900 line-clamp-2">
              {article.title}
            </p>
            <p className="text-sm text-gray-600 line-clamp-2">
              {article.snippet}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Source: {article.source}
            </p>
          </div>
        ))}
      </div>
    </div>
  );

  const renderLessonView = () => (
    <div className="p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-2xl space-y-6">
      <div className="flex justify-between items-center border-b pb-4">
        <button
          onClick={() => setAppState('NEWS_LIST')}
          className="flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-1" /> Back to Articles
        </button>
        <h2 className="text-2xl font-extrabold text-blue-700 text-center flex-grow mx-4 truncate">
          {currentLesson?.articleTitle || "Generated Lesson"}
        </h2>
        <button
          onClick={() => {
            setCurrentLesson(null);
            setCurrentArticle(null);
            setAppState('INPUT');
          }}
          className="flex items-center text-indigo-600 hover:text-indigo-800 text-sm font-medium"
          title="Start New Topic"
        >
          <RestartIcon className="w-4 h-4 mr-1" /> New Topic
        </button>
      </div>

       <p className="text-sm text-gray-600">
         <strong>Source:</strong> <a href={currentArticle?.link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{currentArticle?.source}</a> ({currentArticle?.date})
       </p>


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
        <p className="text-gray-800">
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

  // Render main app content if signed in
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100 font-inter">
      <div className="w-full">
        {/* Always show error at the top if it exists */}
        {error && <ErrorMessage message={error} />}

        {/* Show loading spinner only when appState is LOADING */}
        {appState === 'LOADING' && <LoadingSpinner text="Working..." />}

        {/* Conditionally render screens based on appState, assuming user is signed in */}
        {appState === 'INPUT' && renderInput()}
        {appState === 'NEWS_LIST' && renderNewsList()}
        {appState === 'LESSON_VIEW' && renderLessonView()}
      </div>
    </div>
  );
};

export default App;