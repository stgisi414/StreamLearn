import React from 'react';
import { useTranslation } from 'react-i18next';
import { Lesson, ActivityState, LanguageCode, EnglishLevel } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { ActivityContent } from './ActivityContent';
import { ActivityControls } from './ActivityControls';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ArrowLeftIcon } from './icons/ArrowLeftIcon';
import { VolumeUpIcon } from './icons/VolumeUpIcon';
import { PlayIcon } from './icons/PlayIcon';
import { PauseIcon } from './icons/PauseIcon';
import { BookmarkIcon } from './icons/BookmarkIcon';
import { SavedWord, VocabularyItem } from '../types';
import { RestartIcon } from './icons/RestartIcon';
import { LightBulbIcon } from './icons/LightBulbIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';

interface GuidedLessonFlowProps {
  lesson: Lesson;
  activityState: ActivityState | null;
  currentStep: number;
  setStep: (step: number) => void;
  startActivity: (type: ActivityState['type']) => void;
  onSpeak: (text: string, langCode: LanguageCode) => void;
  isAudioLoading: boolean;
  onAnswerChange: (answer: string | number | null) => void;
  onSubmitAnswer: () => void;
  onFinish: () => void;
  // --- NEW: Summary Audio Player Props ---
  summaryAudioSrc: string | null;
  summaryAudioDuration: number;
  summaryAudioProgress: number;
  isSummaryPlaying: boolean;
  isSummaryAudioLoading: boolean;
  summaryAudioError: string | null;
  toggleSummaryPlayPause: () => void;
  handleSeek: (event: React.ChangeEvent<HTMLInputElement>) => void;
  formatTime: (timeInSeconds: number) => string;
  // --- NEW: Word Bank & Language Props ---
  targetLanguage: LanguageCode;
  wordBank: SavedWord[];
  handleSaveWord: (item: VocabularyItem) => void;
  // --- NEW: Grammar Example Props ---
  generatedGrammarExamples: string[];
  isGeneratingExample: boolean;
  handleGenerateGrammarExample: () => void;
  // --- NEW: Comprehension Answer Props ---
  comprehensionAnswers: Record<number, string>;
  isAnswerLoading: number | null;
  handleFetchComprehensionAnswer: (question: string, index: number) => void;
}

// Reusable SpeakButton for this component
const SpeakButton: React.FC<{ text: string | undefined | null, langCode: LanguageCode, isAudioLoading: boolean, onSpeak: (text: string, langCode: LanguageCode) => void, t: (key: string) => string }> = ({ text, langCode, isAudioLoading, onSpeak, t }) => (
  <button
     onClick={() => text && onSpeak(text, langCode)}
     disabled={isAudioLoading || !text}
     className="ml-2 p-1 text-gray-500 hover:text-blue-600 disabled:opacity-50 inline-block align-middle cursor-pointer disabled:cursor-not-allowed"
     title={t('common.readAloud')}
   >
     {isAudioLoading ? (
          <LoadingSpinner className="w-4 h-4 inline-block" />
     ) : (
          <VolumeUpIcon className="w-5 h-5" />
     )}
  </button>
);

export const GuidedLessonFlow: React.FC<GuidedLessonFlowProps> = (props) => {
  const { t } = useTranslation();
  const { 
    lesson, activityState, currentStep, setStep, startActivity, 
    onSpeak, isAudioLoading, onAnswerChange, onSubmitAnswer, onFinish,
    targetLanguage, wordBank, handleSaveWord,
    generatedGrammarExamples, isGeneratingExample, handleGenerateGrammarExample,
    comprehensionAnswers, isAnswerLoading, handleFetchComprehensionAnswer,
    // --- NEW: Destructure Audio Props ---
    summaryAudioSrc, summaryAudioDuration, summaryAudioProgress, isSummaryPlaying,
    isSummaryAudioLoading, summaryAudioError, toggleSummaryPlayPause, handleSeek, formatTime,
  } = props;

  // Define the steps
  const steps = [
    { name: t('lesson.summaryTitle'), type: 'content' as const, activity: null },
    { name: t('lesson.vocabBuilder'), type: 'content' as const, activity: null },
    { name: t('activity.vocab'), type: 'activity' as const, activity: 'vocab' as ActivityState['type'] },
    { name: t('lesson.grammarFocus'), type: 'content' as const, activity: null },
    { name: t('activity.grammar'), type: 'activity' as const, activity: 'grammar' as ActivityState['type'] },
    { name: t('lesson.comprehensionQuestions'), type: 'content' as const, activity: null },
    { name: t('activity.comprehension'), type: 'activity' as const, activity: 'comprehension' as ActivityState['type'] },
    { name: t('activity.writing'), type: 'activity' as const, activity: 'writing' as ActivityState['type'] },
    { name: t('common.finish'), type: 'content' as const, activity: null }
  ];

  const currentStepData = steps[currentStep];

  // Effect to start the activity when a step is an activity
  React.useEffect(() => {
    if (currentStepData.type === 'activity' && currentStepData.activity) {
      // Start activity if it's not already the correct one
      if (!activityState || activityState.type !== currentStepData.activity) {
        startActivity(currentStepData.activity);
      }
    }
  }, [currentStep, currentStepData.type, currentStepData.activity, activityState, startActivity]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setStep(currentStep + 1);
    } else {
      onFinish(); // This will call quitActivity
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setStep(currentStep - 1);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      // Step 0: Summary
      case 0:
        return (
          <div className="space-y-2 border-l-4 border-blue-500 pl-4 bg-blue-50 p-3 rounded-lg"> 
            {/* --- NEW: Audio Player --- */}
            {isSummaryAudioLoading && <LoadingSpinner className="w-5 h-5 inline-block mr-2"/>}
            {summaryAudioError && <span className="text-red-600 text-xs ml-2">{t('lesson.audioFail')} {summaryAudioError}</span>}
 
            {summaryAudioSrc && summaryAudioDuration > 0 && (
              <div className="flex items-center gap-2 bg-gray-100 p-2 rounded border border-gray-300 my-2">
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
            <div className="mt-2 clearfix">
              <p className="text-gray-800 whitespace-pre-wrap">{lesson.summary}</p>
            </div>
          </div>
        );
      
      // Step 1: Vocabulary List
      case 1:
        return (
          <div className="space-y-3 border-l-4 border-yellow-500 pl-4 bg-yellow-50 p-3 rounded-lg">
            <ul className="space-y-3">
              {lesson.vocabularyList.map((item, index) => {
                const isSaved = wordBank.some(w => w.word === item.word);
                return (
                  <li key={index} className="text-gray-800 flex justify-between items-start gap-2">
                    <div className="flex-grow">
                      <strong className="text-yellow-900">{item.word}:</strong> {item.definition}
                      <p className="text-sm italic text-gray-600 mt-1">{t('common.example')} "{item.articleExample}"</p>
                    </div>
                    {/* --- FIX: Add Bookmark Button --- */}
                    <button
                      onClick={() => handleSaveWord(item)}
                      disabled={isSaved}
                      title={isSaved ? t('common.saved') : t('common.saveWord')}
                      className="p-1 text-purple-600 hover:text-purple-800 disabled:text-gray-400 disabled:cursor-default flex-shrink-0"
                    >
                      <BookmarkIcon className="w-5 h-5" isSolid={isSaved} />
                    </button>
                    {/* --- FIX: Use targetLanguage prop for audio --- */}
                    <SpeakButton text={item.articleExample} langCode={targetLanguage} isAudioLoading={isAudioLoading} onSpeak={onSpeak} t={t} />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      
      // Step 2: Vocab Quiz
      case 2:
        if (!activityState || activityState.type !== 'vocab') return <LoadingSpinner text={t('activity.init')} />;
        return (
          <div className="p-4 border rounded-lg">
            <ActivityContent 
              activityState={activityState} 
              inputLevel={lesson.level as EnglishLevel} // Assuming lesson has level
              uiLanguage={props.uiLanguage} 
              targetLanguage={targetLanguage}
              isAudioLoading={isAudioLoading} 
              onSpeak={onSpeak} 
              onAnswerChange={onAnswerChange}
            />
          </div>
        );
        
      // Step 3: Grammar Focus
      case 3:
        return (
          <div className="space-y-3 border-l-4 border-purple-500 pl-4 bg-purple-50 p-3 rounded-lg">
            <MarkdownRenderer content={lesson.grammarFocus.explanation || ''} className="text-gray-800 mt-2"/>
            {/* --- NEW: Add Grammar Example Generator --- */}
            <div className="mt-4">
              {/* Render generated examples */}
              {generatedGrammarExamples.length > 0 && (
                <ul className="space-y-2 mb-3">
                  {generatedGrammarExamples.map((example, index) => (
                    <li key={index} className="text-gray-700 italic border-t pt-2 flex justify-between items-center">
                      <span>"{example}"</span>
                      <SpeakButton text={example} langCode={targetLanguage} isAudioLoading={isAudioLoading} onSpeak={onSpeak} t={t} />
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
        );

      // Step 4: Grammar Quiz
      case 4:
        if (!activityState || activityState.type !== 'grammar') return <LoadingSpinner text={t('activity.init')} />;
        return (
          <div className="p-4 border rounded-lg">
            <ActivityContent 
              activityState={activityState} 
              inputLevel={lesson.level as EnglishLevel}
              uiLanguage={props.uiLanguage} 
              targetLanguage={targetLanguage}
              isAudioLoading={isAudioLoading} 
              onSpeak={onSpeak} 
              onAnswerChange={onAnswerChange}
            />
          </div>
        );

      // Step 5: Comprehension Questions (Content)
      case 5:
        return (
          <div className="space-y-3 border-l-4 border-green-500 pl-4 bg-green-50 p-3 rounded-lg">
            <ol className="list-decimal list-inside space-y-4">
              {lesson.comprehensionQuestions.map((q, index) => (
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
        );
        
      // Step 6: Comprehension Quiz
      case 6:
        if (!activityState || activityState.type !== 'comprehension') return <LoadingSpinner text={t('activity.init')} />;
        return (
          <div className="p-4 border rounded-lg">
            <ActivityContent 
              activityState={activityState} 
              inputLevel={lesson.level as EnglishLevel}
              uiLanguage={props.uiLanguage} 
              targetLanguage={targetLanguage}
              isAudioLoading={isAudioLoading} 
              onSpeak={onSpeak} 
              onAnswerChange={onAnswerChange}
            />
          </div>
        );

      // Step 7: Writing Quiz
      case 7:
        if (!activityState || activityState.type !== 'writing') return <LoadingSpinner text={t('activity.init')} />;
        return (
          <div className="p-4 border rounded-lg">
            <ActivityContent 
              activityState={activityState} 
              inputLevel={lesson.level as EnglishLevel}
              uiLanguage={props.uiLanguage} 
              targetLanguage={targetLanguage}
              isAudioLoading={isAudioLoading} 
              onSpeak={onSpeak} 
              onAnswerChange={onAnswerChange}
            />
          </div>
        );

      // Step 8: Finish Screen
      case 8:
        return (
          <div className="text-center p-10 flex flex-col items-center justify-center min-h-[300px] bg-green-50 rounded-lg border border-green-200">
            <CheckCircleIcon className="w-16 h-16 text-green-500" />
            <h2 className="text-2xl font-bold text-gray-800 mt-4">
              {t('activity.complete')}
            </h2>
            <p className="text-lg text-gray-600 mt-2">              
              {t('lesson.guidedComplete')}
            </p>
          </div>
        );
      
      default:
        return <p>Unknown step.</p>;
    }
  };

  const renderActivityControls = () => {
    if (currentStepData.type !== 'activity' || !activityState || !activityState.currentData) {
      return null; // Don't show controls for content steps or if activity isn't ready
    }

    // Check if this is the last *quiz* step before the "Finish" screen
    const isLastQuizStep = currentStep === steps.length - 2;

    return (
      <ActivityControls
        activityState={activityState}
        onSubmit={onSubmitAnswer}
        // FIX: Always call onNextQuestion. It has the logic to check
        // if it's the last question and advance the step.
        onNext={props.onNextQuestion}
        isLastStep={activityState.index + 1 >= activityState.total && isLastQuizStep}
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* 1. Header & Progress Bar */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-gray-500">{t('common.question')} {currentStep + 1} / {steps.length}</span>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div 
            className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          ></div>
        </div>
        <h2 className="text-2xl font-bold text-gray-800 pt-2">{steps[currentStep].name}</h2>
      </div>

      {/* 2. Main Content Area */}
      <div className="min-h-[50px]">
        {renderStepContent()}
      </div>

      {/* 3. Feedback Area (for activities) */}
      {activityState && activityState.feedback.message && (
        <div className={`mt-4 p-3 rounded text-sm ${activityState.feedback.isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {activityState.feedback.message}
        </div>
      )}

      {/* 4. Navigation */}
      <div className="flex justify-between items-center border-t pt-4">
        {/* --- FIX: Hide Back button on the last step --- */}
        {currentStep < (steps.length - 1) ? (
          <button
            onClick={handleBack}
            disabled={currentStep === 0}
            className="flex items-center gap-1 text-gray-600 font-medium py-2 px-4 rounded-lg hover:bg-gray-100 transition duration-150 disabled:opacity-50"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            {t('common.back')}
          </button>
        ) : (
          <div></div> // Empty div to keep the "Finish" button on the right
        )}

        {/* Show activity controls OR the simple "Next" button */}
        {currentStepData.type === 'activity' ? (
          renderActivityControls()
        ) : (
          <button
            onClick={handleNext}
            className="bg-blue-600 text-white font-bold py-2 px-5 rounded-lg hover:bg-blue-700 transition duration-150"
          >
            {currentStep === steps.length - 1 ? t('common.finish') : t('common.next')}
          </button>
        )}
      </div>
    </div>
  );
};