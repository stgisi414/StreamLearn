import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, User, signInWithCustomToken, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, doc, setDoc, Timestamp } from 'firebase/firestore';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ErrorMessage } from './components/ErrorMessage';
import { RestartIcon } from './components/icons/RestartIcon';
import { ArrowLeftIcon } from './components/icons/ArrowLeftIcon';
import { Lesson, Article, NewsResult, EnglishLevel, LessonResponse } from './types';

// --- Configuration Variables ---
const rawConfig = (window as any).__firebase_config;

const firebaseConfig = {
  projectId: 'streamlearnxyz',
  // Use FAKE key for local emulator stability
  apiKey: 'FAKE_LOCAL_DEV_KEY', 
  ...(JSON.parse(
    (typeof rawConfig === 'string' && rawConfig) ? rawConfig : '{}'
  ))
};

const __initial_auth_token: string | undefined = (window as any).__initial_auth_token;

/**
 * Determines the base URL for the Cloud Functions.
 * Uses the '/api' Vite proxy path for local development to bypass CORS.
 */
function getFunctionBaseUrl(): string {
  // If running locally, use the Vite proxy path
  const isDevelopment = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (isDevelopment) {
    return "/api"; 
  }

  // Check for hosted environment variable
  const hostedFullUrl = (window as any).functionBaseUrl; 

  if (typeof hostedFullUrl === 'string' && hostedFullUrl.length > 0) {
    // Attempt to clean the base URL if necessary 
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
  const [authState, setAuthState] = useState<'LOADING' | 'READY'>('LOADING');
  const [appState, setAppState] = useState<AppState>('INPUT');
  const [error, setError] = useState<string | null>(null);

  const [inputTopic, setInputTopic] = useState('');
  const [inputLevel, setInputLevel] = useState<EnglishLevel>('Intermediate');
  
  const [newsResults, setNewsResults] = useState<NewsResult[]>([]);
  const [currentArticle, setCurrentArticle] = useState<Article | null>(null);
  const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);

  const db = useMemo(() => getFirestore(initializeApp(firebaseConfig)), []);
  
  // 1. Firebase Initialization & Auth Effect
  // 1. Firebase Initialization & Auth Effect
  useEffect(() => {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    // CRITICAL FIX: Connect auth emulator explicitly if running locally
    const isDevelopment = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isDevelopment) {
        // FIX: Use 'localhost' for consistency and to avoid potential OS-level binding issues with 127.0.0.1.
        connectAuthEmulator(auth, "http://localhost:9099");
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        try {
          if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
          } else {
            // Sign in anonymously if no custom token is available
            await signInAnonymously(auth);
          }
        } catch (e) {
          console.error("Authentication Error:", e);
          // Set a user-friendly error state on failure
          setError("Failed to connect to authentication server. Please ensure Firebase Emulators are running.");
          setAuthState('READY');
          return;
        }
      }
      setAuthState('READY');
    });
    return () => unsubscribe();
  }, []);

  // --- Core Fetch Helper ---
  const authenticatedFetch = useCallback(async (functionName: string, body: any) => {
    if (!user) {
        throw new Error("Authentication failed: User token missing.");
    }

    const idToken = await user.getIdToken();
    // Use the proxy path if local: /api/fetchNews
    const url = `${BASE_FUNCTION_URL}/${functionName}`;

    try {
        const response = await fetch(url, {
            method: "POST", 
            headers: {
                "Content-Type": "application/json",
                // Pass the ID token in the Authorization header for backend validation
                "Authorization": `Bearer ${idToken}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorData: any = {};
            try {
                // Attempt to parse JSON error response from the function
                errorData = JSON.parse(errorText);
            } catch {
                // If response isn't JSON, use status and text
            }
            const errorMessage = errorData.error || errorData.details || `Request failed with status ${response.status}`;
            throw new Error(errorMessage);
        }

        return response.json();
    } catch (e) {
        // Re-throw the error to be caught by the calling handler
        throw e;
    }
  }, [user]);

  // 2. Function Call Logic: Find Articles
  const handleFindArticles = useCallback(async () => {
    if (inputTopic.trim() === '') {
      setError("Please enter a topic of interest.");
      return;
    }
    if (authState !== 'READY') return;

    setAppState('LOADING');
    setError(null);
    setNewsResults([]);

    try {
      const results = await authenticatedFetch('fetchNews', { 
        query: inputTopic, 
        languageCode: 'en'
      }) as NewsResult[];

      if (!results || results.length === 0) {
        setError("No current news articles found for that topic.");
        setAppState('INPUT');
      } else {
        setNewsResults(results.filter(r => r.title && r.link));
        setAppState('NEWS_LIST');
      }
    } catch (e) {
      console.error("Fetch News Error:", e);
      setError(`Failed to fetch news: ${(e as Error).message}.`);
      setAppState('INPUT');
    }
  }, [inputTopic, authState, authenticatedFetch]);

  // 3. Function Call Logic: Create Lesson
  const handleSelectArticle = useCallback(async (article: NewsResult) => {
    if (authState !== 'READY') return;

    setAppState('LOADING');
    setError(null);
    setCurrentArticle(article);
    setCurrentLesson(null);

    try {
      const responseData = await authenticatedFetch('createLesson', { 
        articleUrl: article.link, 
        level: inputLevel 
      }) as LessonResponse;

      if (responseData.success && responseData.lesson) {
        const lesson = responseData.lesson;
        setCurrentLesson(lesson);
        setAppState('LESSON_VIEW');

        // Save lesson to Firestore 
        if (user) {
            await setDoc(doc(db, `artifacts/${firebaseConfig.projectId}/users/${user.uid}/lessons`, lesson.articleTitle.substring(0, 50) + '-' + Date.now()), {
              userId: user.uid,
              topic: inputTopic,
              level: inputLevel,
              articleUrl: article.link,
              lesson: lesson,
              timestamp: Timestamp.now()
            });
        }
      } else {
        throw new Error("Lesson generation failed or returned no lesson object.");
      }
    } catch (e) {
      console.error("Lesson Error:", e);
      setError(`Failed to create the lesson: ${(e as Error).message}.`);
      setAppState('NEWS_LIST');
    }
  }, [inputLevel, authState, db, inputTopic, authenticatedFetch, user]);

  // 4. Render Logic
  if (authState === 'LOADING') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <LoadingSpinner text="Connecting to services and authenticating..." />
      </div>
    );
  }

  const renderInput = () => (
    <div className="p-6 max-w-lg mx-auto bg-white rounded-xl shadow-2xl space-y-6">
      <h2 className="text-3xl font-extrabold text-blue-700 text-center">
        StreamLearn AI
      </h2>
      <p className="text-gray-500 text-center">
        Learn English with articles tailored to your interests and level.
      </p>

      {/* Level Selection */}
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

      {/* Topic Input */}
      <div>
        <label htmlFor="topic" className="block text-sm font-medium text-gray-700 mb-2">
          What topics interest you? (e.g., AI, Space, Cooking)
        </label>
        <input
          id="topic"
          type="text"
          value={inputTopic}
          onChange={(e) => setInputTopic(e.target.value)}
          placeholder="Enter a topic"
          className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <button
        onClick={handleFindArticles}
        disabled={!user}
        className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition duration-150 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Find Articles
      </button>
      {user && <p className="text-xs text-slate-500 text-center">User ID: {user.uid.substring(0, 8)}... (Authenticated)</p>}
    </div>
  );

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
        <h2 className="text-2xl font-extrabold text-blue-700">
          {currentLesson?.articleTitle || "Generated Lesson"}
        </h2>
        <button 
          onClick={() => {
            setCurrentLesson(null);
            setCurrentArticle(null);
            setAppState('INPUT');
          }}
          className="flex items-center text-red-600 hover:text-red-800 text-sm font-medium"
        >
          <RestartIcon className="w-4 h-4 mr-1" /> Start New
        </button>
      </div>

      <p className="text-sm text-gray-600">
        **Article Link:** <a href={currentArticle?.link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{currentArticle?.link}</a>
      </p>

      {/* Vocabulary Section */}
      <div className="space-y-3 border-l-4 border-yellow-500 pl-4 bg-yellow-50 p-3 rounded-lg">
        <h3 className="text-xl font-bold text-yellow-700">Vocabulary Builder</h3>
        <ul className="space-y-3">
          {currentLesson?.vocabularyList?.map((item, index) => (
            <li key={index} className="text-gray-800">
              <strong className="text-yellow-900">{item.word} ({item.definition})</strong>
              <p className="text-sm italic text-gray-600">"{item.articleExample}"</p>
            </li>
          ))}
        </ul>
      </div>

      {/* Grammar Section */}
      <div className="space-y-3 border-l-4 border-purple-500 pl-4 bg-purple-50 p-3 rounded-lg">
        <h3 className="text-xl font-bold text-purple-700">Grammar Focus</h3>
        <p className="text-gray-800">
          <strong className="text-purple-900">{currentLesson?.grammarFocus?.topic}:</strong> 
          {" "}{currentLesson?.grammarFocus?.explanation}
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


  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100 font-inter">
      <div className="w-full">
        {error && <ErrorMessage message={error} />}
        {appState === 'LOADING' && <LoadingSpinner text="Fetching data..." />}
        {appState === 'INPUT' && renderInput()}
        {appState === 'NEWS_LIST' && renderNewsList()}
        {appState === 'LESSON_VIEW' && renderLessonView()}
      </div>
    </div>
  );
};

export default App;