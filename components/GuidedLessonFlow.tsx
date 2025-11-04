import React from 'react';
import { useTranslation } from 'react-i18next';
import { Lesson, ActivityState, LanguageCode, EnglishLevel } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { ActivityContent } from './ActivityContent';
import { ActivityControls } from './ActivityControls';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ArrowLeftIcon } from './icons/ArrowLeftIcon';
import { VolumeUpIcon } from './icons/VolumeUpIcon';

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
  const { lesson, activityState, currentStep, setStep, startActivity, onSpeak, isAudioLoading, onAnswerChange, onSubmitAnswer, onFinish } = props;

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
            <h3 className="text-xl font-bold text-blue-700">{t('lesson.summaryTitle')}</h3>
            <div className="mt-2 clearfix">
              <p className="text-gray-800 whitespace-pre-wrap">{lesson.summary}</p>
            </div>
          </div>
        );
      
      // Step 1: Vocabulary List
      case 1:
        return (
          <div className="space-y-3 border-l-4 border-yellow-500 pl-4 bg-yellow-50 p-3 rounded-lg">
            <h3 className="text-xl font-bold text-yellow-700">{t('lesson.vocabBuilder')}</h3>
            <ul className="space-y-3">
              {lesson.vocabularyList.map((item, index) => (
                <li key={index} className="text-gray-800 flex justify-between items-start gap-2">
                  <div className="flex-grow">
                    <strong className="text-yellow-900">{item.word}:</strong> {item.definition}
                    <p className="text-sm italic text-gray-600 mt-1">{t('common.example')} "{item.articleExample}"</p>
                  </div>
                  <SpeakButton text={item.articleExample} langCode={activityState?.currentData?.targetLanguage || 'en'} isAudioLoading={isAudioLoading} onSpeak={onSpeak} t={t} />
                </li>
              ))}
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
            <h3 className="text-xl font-bold text-purple-700">{t('lesson.grammarFocus')} {lesson.grammarFocus.topic}</h3>
            <MarkdownRenderer content={lesson.grammarFocus.explanation || ''} className="text-gray-800 mt-2"/>
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
            <h3 className="text-xl font-bold text-green-700">{t('lesson.comprehensionQuestions')}</h3>
            <ol className="list-decimal list-inside space-y-4">
              {lesson.comprehensionQuestions.map((q, index) => (
                <li key={index} className="text-gray-800">
                  <span>{q}</span>
                </li>
              ))}
            </ol>
            <p className="text-sm text-gray-600 italic">{t('activity.comprehension') + " " + t('common.next') + "..."}</p>
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
              isAudioLoading={isAudioLoading} 
              onSpeak={onSpeak} 
              onAnswerChange={onAnswerChange}
            />
          </div>
        );

      // Step 8: Finish Screen
      case 8:
        return (
          <div className="text-center p-6 bg-gray-50 rounded-lg">
            <h2 className="text-2xl font-bold text-blue-700">{t('activity.complete')}</h2>
            <p className="text-lg text-gray-700 mt-2">
              {t('activity.backToLesson')}
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
        onNext={() => {
          // If we are on the last step of an activity (e.g. 5/5), just call handleNext to move to the next screen
          if (activityState.index + 1 >= activityState.total) {
            handleNext();
          } else {
            // Otherwise, just call the normal activity "next question" handler
            props.onNextQuestion();
          }
        }}
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
      <div className="min-h-[300px]">
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
        <button
          onClick={handleBack}
          disabled={currentStep === 0}
          className="flex items-center gap-1 text-gray-600 font-medium py-2 px-4 rounded-lg hover:bg-gray-100 transition duration-150 disabled:opacity-50"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          {t('common.back')}
        </button>

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