
import React, { useState, useCallback } from 'react';
import { EnglishLevel, BrightDataArticle, Lesson } from './types';
import { fetchNewsArticles } from './services/brightDataService';
import { fetchArticleContent } from './services/articleScraperService';
import { generateLesson } from './services/geminiService';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ErrorMessage } from './components/ErrorMessage';
import { ArrowLeftIcon } from './components/icons/ArrowLeftIcon';
import { RestartIcon } from './components/icons/RestartIcon';

type View = 'input' | 'articles' | 'lesson';

const App: React.FC = () => {
    const [view, setView] = useState<View>('input');
    const [interests, setInterests] = useState<string>('');
    const [level, setLevel] = useState<EnglishLevel>('Intermediate');
    const [articles, setArticles] = useState<BrightDataArticle[]>([]);
    const [selectedArticle, setSelectedArticle] = useState<BrightDataArticle | null>(null);
    const [articleContent, setArticleContent] = useState<string>('');
    const [lesson, setLesson] = useState<Lesson | null>(null);

    const [isLoading, setIsLoading] = useState({
        articles: false,
        content: false,
        lesson: false,
    });
    const [error, setError] = useState<string | null>(null);

    const handleFindArticles = async () => {
        if (!interests.trim()) {
            setError('Please enter your interests.');
            return;
        }
        setError(null);
        setIsLoading(prev => ({ ...prev, articles: true }));
        try {
            const fetchedArticles = await fetchNewsArticles(interests);
            setArticles(fetchedArticles);
            setView('articles');
        } catch (e: any) {
            setError(e.message || 'An unknown error occurred.');
        } finally {
            setIsLoading(prev => ({ ...prev, articles: false }));
        }
    };

    const handleSelectArticle = useCallback(async (article: BrightDataArticle) => {
        setSelectedArticle(article);
        setView('lesson');
        setError(null);
        setArticleContent('');
        setLesson(null);

        setIsLoading(prev => ({ ...prev, content: true, lesson: true }));

        try {
            // Fetch placeholder content
            const content = await fetchArticleContent(article.link);
            setArticleContent(content);
            setIsLoading(prev => ({ ...prev, content: false }));

            // Generate lesson with the fetched content
            const generatedLesson = await generateLesson(content, level);
            setLesson(generatedLesson);
        } catch (e: any) {
            setError(e.message || 'Failed to prepare the lesson.');
        } finally {
            setIsLoading(prev => ({ ...prev, content: false, lesson: false }));
        }
    }, [level]);
    
    const handleStartOver = () => {
        setView('input');
        setInterests('');
        setArticles([]);
        setSelectedArticle(null);
        setArticleContent('');
        setLesson(null);
        setError(null);
    };

    const renderInputView = () => (
        <div className="w-full max-w-lg mx-auto bg-slate-800/50 p-8 rounded-xl shadow-2xl backdrop-blur-sm border border-slate-700">
            <h2 className="text-3xl font-bold text-center text-sky-300 mb-2">Welcome to StreamLearn</h2>
            <p className="text-center text-slate-400 mb-8">Tell us what you're interested in to get started.</p>
            
            <div className="space-y-6">
                <div>
                    <label htmlFor="interests" className="block text-sm font-medium text-slate-300 mb-2">What topics interest you?</label>
                    <input
                        type="text"
                        id="interests"
                        value={interests}
                        onChange={(e) => setInterests(e.target.value)}
                        placeholder="e.g., space exploration, renewable energy"
                        className="w-full bg-slate-900 border border-slate-600 rounded-md px-4 py-2 text-slate-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Select your English level:</label>
                    <div className="grid grid-cols-3 gap-2 rounded-md bg-slate-900 p-1 border border-slate-700">
                        {(['Beginner', 'Intermediate', 'Advanced'] as EnglishLevel[]).map((l) => (
                            <button
                                key={l}
                                onClick={() => setLevel(l)}
                                className={`px-4 py-2 text-sm font-semibold rounded transition ${level === l ? 'bg-sky-600 text-white shadow-md' : 'text-slate-300 hover:bg-slate-700/50'}`}
                            >
                                {l}
                            </button>
                        ))}
                    </div>
                </div>

                <button
                    onClick={handleFindArticles}
                    disabled={isLoading.articles}
                    className="w-full bg-sky-600 text-white font-bold py-3 px-4 rounded-md hover:bg-sky-500 disabled:bg-slate-600 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center shadow-lg"
                >
                    {isLoading.articles ? <LoadingSpinner className="w-6 h-6"/> : 'Find Articles'}
                </button>
            </div>
             <ErrorMessage message={error || ''} />
        </div>
    );

    const renderArticlesView = () => (
        <div className="w-full max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold text-sky-300">Relevant Articles</h2>
                <button onClick={handleStartOver} className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold py-2 px-4 rounded-md transition">
                    <RestartIcon className="w-5 h-5" />
                    Start Over
                </button>
            </div>
            <div className="space-y-4">
                {articles.map((article, index) => (
                    <div
                        key={index}
                        onClick={() => handleSelectArticle(article)}
                        className="bg-slate-800 p-6 rounded-lg border border-slate-700 hover:border-sky-500 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer"
                    >
                        <h3 className="text-xl font-bold text-sky-400 mb-2">{article.title}</h3>
                        <p className="text-slate-400 mb-3 text-sm">{article.snippet}</p>
                        <div className="flex justify-between items-center text-xs text-slate-500">
                            <span>{article.source}</span>
                            <span>{article.timestamp}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderLessonView = () => (
        <div className="w-full max-w-4xl mx-auto">
             <div className="flex justify-between items-center mb-6">
                <button onClick={() => setView('articles')} className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold py-2 px-4 rounded-md transition">
                    <ArrowLeftIcon className="w-5 h-5"/>
                    Back to Articles
                </button>
                <button onClick={handleStartOver} className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold py-2 px-4 rounded-md transition">
                    <RestartIcon className="w-5 h-5" />
                    Start Over
                </button>
            </div>
            
            <div className="bg-slate-800/80 p-6 sm:p-8 rounded-xl border border-slate-700 backdrop-blur-md">
                <h2 className="text-2xl sm:text-3xl font-bold text-sky-300 mb-4">{selectedArticle?.title}</h2>
                
                <div className="prose prose-invert prose-p:text-slate-300 prose-headings:text-sky-400 max-w-none mb-8">
                    {isLoading.content ? <LoadingSpinner text="Fetching article content..." /> : <p className="whitespace-pre-wrap">{articleContent}</p>}
                </div>

                <hr className="border-slate-700 my-8" />
                
                <h3 className="text-2xl font-bold text-sky-300 mb-6">Your Lesson</h3>
                 <ErrorMessage message={error || ''} />

                {isLoading.lesson ? (
                     <LoadingSpinner text="Generating your personalized lesson with AI..." />
                ) : lesson && (
                    <div className="space-y-8">
                        {/* Vocabulary Section */}
                        <div>
                            <h4 className="text-xl font-semibold text-sky-400 mb-4">Vocabulary</h4>
                            <ul className="space-y-4">
                                {lesson.vocabulary.map((item, index) => (
                                    <li key={index} className="p-4 bg-slate-900/50 rounded-md border border-slate-700">
                                        <p><strong className="text-slate-100">{item.word}:</strong> <span className="text-slate-300">{item.definition}</span></p>
                                        <p className="text-sm text-slate-400 italic mt-2">"{item.example}"</p>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Comprehension Questions */}
                        <div>
                            <h4 className="text-xl font-semibold text-sky-400 mb-4">Comprehension Questions</h4>
                            <ol className="list-decimal list-inside space-y-2 text-slate-300">
                                {lesson.comprehensionQuestions.map((q, index) => <li key={index}>{q}</li>)}
                            </ol>
                        </div>
                        
                        {/* Grammar Point */}
                        <div>
                            <h4 className="text-xl font-semibold text-sky-400 mb-4">Grammar Point: {lesson.grammarPoint.title}</h4>
                            <p className="p-4 bg-slate-900/50 rounded-md border border-slate-700 text-slate-300">{lesson.grammarPoint.explanation}</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-900 text-slate-200 font-sans p-4 sm:p-8 flex flex-col items-center">
            <header className="w-full max-w-4xl mx-auto mb-10 text-center">
                <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-300">
                    StreamLearn
                </h1>
            </header>
            <main className="w-full flex-grow flex items-center justify-center">
                {view === 'input' && renderInputView()}
                {view === 'articles' && renderArticlesView()}
                {view === 'lesson' && renderLessonView()}
            </main>
        </div>
    );
};

export default App;
