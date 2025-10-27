import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
// MODIFICATION 1: Ensure connectAuthEmulator is imported
import { getAuth, signInAnonymously, onAuthStateChanged, User, signInWithCustomToken, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, doc, setDoc, Timestamp, collection, query, where, limit, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ErrorMessage } from './components/ErrorMessage';
import { RestartIcon } from './components/icons/RestartIcon';
import { ArrowLeftIcon } from './components/icons/ArrowLeftIcon';
import { Lesson, Article, NewsResult } from './types'; // Assuming these types exist

// --- Configuration Variables ---
// IMPORTANT: These are set by the Canvas environment for security.
const rawConfig = (window as any).__firebase_config;

// FIX: Set apiKey to a non-empty dummy string. This passes the SDK's internal synchronous check, 
// and the Auth Emulator will ignore it for network traffic.
const firebaseConfig = {
  projectId: 'streamlearnxyz',
  apiKey: 'LOCAL_DEV_KEY_MUST_BE_NON_EMPTY', // Set to a non-empty string to pass SDK validation
  ...(JSON.parse(
    (typeof rawConfig === 'string' && rawConfig) ? rawConfig : '{}'
  ))
};

const __initial_auth_token: string | undefined = (window as any).__initial_auth_token;

// --- State Types ---
type AppState = 'LOADING' | 'INPUT' | 'NEWS_LIST' | 'LESSON_VIEW' | 'ERROR';
type EnglishLevel = 'Beginner' | 'Intermediate' | 'Advanced';

// --- Function Call Definitions ---
// Define the structure for the payload and response of the two functions
const functions = getFunctions(initializeApp(firebaseConfig));
const fetchNewsFunction = httpsCallable<
  { query: string; languageCode?: string }, 
  NewsResult[]
>(functions, 'fetchNews');
const createLessonFunction = httpsCallable<
  { articleUrl: string; level: EnglishLevel }, 
  { success: boolean, lesson: Lesson, originalArticleUrl: string }
>(functions, 'createLesson');

// --- Main App Component ---
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
  useEffect(() => {
    const auth = getAuth(initializeApp(firebaseConfig));

    // FIX 2: Check explicitly for the dev environment and IMMEDIATELY connect the emulator.
    const isDevelopment = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    
    if (isDevelopment) {
        // Default Auth emulator port is 9099
        connectAuthEmulator(auth, "http://127.0.0.1:9099");
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        try {
          if (typeof __initial_auth_token !== 'undefined') {
            await signInWithCustomToken(auth, __initial_auth_token);
          } else {
            await signInAnonymously(auth);
          }
        } catch (e) {
          setError("Failed to authenticate user.");
          setAuthState('READY');
          return;
        }
      }
      setAuthState('READY');
    });
    return () => unsubscribe();
  }, []);

  // 2. Function Call Logic
  const handleFindArticles = useCallback(async () => {
    if (inputTopic.trim() === '') {
      setError("Please enter a topic of interest.");
      return;
    }
    setAppState('LOADING');
    setError(null);
    setNewsResults([]);

    try {
      // NOTE: This call is protected by Firebase Authentication on the backend
      const response = await fetchNewsFunction({ 
        query: inputTopic, 
        languageCode: 'en' // Focusing on English news
      });

      const results = response.data.filter(r => r.title && r.link);
      if (results.length === 0) {
        setError("No current news articles found for that topic.");
        setAppState('INPUT');
      } else {
        setNewsResults(results);
        setAppState('NEWS_LIST');
      }
    } catch (e) {
      console.error(e);
      setError("Failed to fetch news. Please check your internet or try again.");
      setAppState('INPUT');
    }
  }, [inputTopic]);

  const handleSelectArticle = useCallback(async (article: NewsResult) => {
    if (!user) return; // Should be impossible if authState === 'READY'

    setAppState('LOADING');
    setError(null);
    setCurrentArticle(article);
    setCurrentLesson(null);

    try {
      // NOTE: This call is protected and handles the scraping/Gemini generation
      const response = await createLessonFunction({ 
        articleUrl: article.link, 
        level: inputLevel 
      });

      if (response.data.success && response.data.lesson) {
        const lesson = response.data.lesson;
        setCurrentLesson(lesson);
        setAppState('LESSON_VIEW');

        // Save lesson to Firestore (for history/subscriptions)
        await setDoc(doc(db, `artifacts/${firebaseConfig.projectId}/users/${user.uid}/lessons`, lesson.articleTitle.substring(0, 50) + '-' + Date.now()), {
          userId: user.uid,
          topic: inputTopic,
          level: inputLevel,
          articleUrl: article.link,
          lesson: lesson,
          timestamp: Timestamp.now()
        });
      } else {
        throw new Error("Lesson generation failed.");
      }
    } catch (e) {
      console.error("Lesson Error:", e);
      setError("Failed to create the lesson. The article source may be blocked.");
      setAppState('NEWS_LIST');
    }
  }, [inputLevel, user, db, inputTopic, createLessonFunction]);

  // 3. Render Logic
  if (authState === 'LOADING') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <LoadingSpinner />
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
        className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition duration-150 shadow-lg"
      >
        Find Articles
      </button>
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
        {appState === 'LOADING' && <LoadingSpinner />}
        {appState === 'INPUT' && renderInput()}
        {appState === 'NEWS_LIST' && renderNewsList()}
        {appState === 'LESSON_VIEW' && renderLessonView()}
      </div>
    </div>
  );
};

export default App;
