import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityState, EnglishLevel, LanguageCode } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { VolumeUpIcon } from './icons/VolumeUpIcon';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ActivityContentProps {
  activityState: ActivityState;
  inputLevel: EnglishLevel;
  uiLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  isAudioLoading: boolean;
  onSpeak: (text: string, langCode: LanguageCode) => void;
  onAnswerChange: (answer: string | number | null) => void;
}

// Reusable SpeakButton specific to this component's props
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

export const ActivityContent: React.FC<ActivityContentProps> = ({
  activityState,
  inputLevel,
  uiLanguage,
  targetLanguage,
  isAudioLoading,
  onSpeak,
  onAnswerChange
}) => {
  const { t } = useTranslation();
  const { type, currentData, userAnswer, feedback, isSubmitting } = activityState;

  if (!currentData) {
    // This can happen briefly between steps
    return <LoadingSpinner text={t('common.loading')} />;
  }
  
  const isGraded = feedback.isCorrect !== null;

  return (
    <div className="mt-4 space-y-4">
      {/* Vocabulary Flashcard */}
      {type === 'vocab' && currentData.definition && (
        <div>
          <p className="text-lg font-semibold text-gray-700 mb-2">
            {t('activity.definition')}
            {/* --- FIX: Use targetLanguage for Advanced, uiLanguage for others --- */}
             <SpeakButton 
               text={currentData.question} 
               langCode={inputLevel === 'Advanced' ? targetLanguage : uiLanguage} 
               isAudioLoading={isAudioLoading} 
               onSpeak={onSpeak} 
               t={t} 
             />
          </p>
          <p className="p-3 bg-gray-100 text-gray-900 rounded mb-4">{currentData.definition}</p>

          {inputLevel === 'Advanced' ? (
            <>
              <label htmlFor="vocab-guess" className="block text-sm font-medium text-gray-700 mb-1">{t('activity.typeWord')}</label>
              <input
                id="vocab-guess"
                type="text"
                value={String(userAnswer ?? '')}
                onChange={(e) => onAnswerChange(e.target.value)}
                disabled={isGraded || isSubmitting}
                className="w-full p-2 border border-gray-300 text-gray-900 rounded disabled:bg-gray-100"
              />
            </>
          ) : (
            <>
              <p className="block text-sm font-medium text-gray-700 mb-2">{t('activity.chooseWord')}</p>
              <div className="space-y-2">
                {currentData.options?.map((option: string) => {
                  let buttonClass = "w-full text-left text-gray-900 p-3 border rounded transition duration-150 ";
                  const isSelected = userAnswer === option;

                  if (isGraded) {
                    if (option === currentData.word) {
                      buttonClass += "bg-green-300 border-green-400"; // Correct answer
                    } else if (isSelected && !feedback.isCorrect) {
                      buttonClass += "bg-red-200 border-red-400"; // Incorrect selection
                    } else {
                      buttonClass += "bg-gray-200 border-gray-300 opacity-70"; // Other options
                    }
                  } else {
                    buttonClass += isSelected
                                    ? "bg-blue-300 border-blue-400" // Selected
                                    : "bg-white border-gray-300 hover:bg-gray-50"; // Not selected
                  }

                  return (
                    <button
                      key={option}
                      onClick={() => onAnswerChange(option)}
                      disabled={isGraded || isSubmitting}
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

      {/* Word Bank Study Mode (Def -> Word) */}
      {type === 'wordbank_study' && currentData.definition && (
        <div>
          <p className="text-lg font-semibold text-gray-700 mb-2">
            {t('activity.definition')}
            <SpeakButton text={currentData.definition} langCode={currentData.uiLanguage} isAudioLoading={isAudioLoading} onSpeak={onSpeak} t={t} />
          </p>
          <p className="p-3 bg-gray-100 text-gray-900 rounded mb-4">{currentData.definition}</p>
          <label htmlFor="vocab-guess" className="block text-sm font-medium text-gray-700 mb-1">
            {t('activity.typeWordLanguage', { language: t(`languages.${currentData.targetLanguage}`) })}
          </label>
          <input
            id="vocab-guess"
            type="text"
            value={String(userAnswer ?? '')}
            onChange={(e) => onAnswerChange(e.target.value)}
            disabled={isGraded || isSubmitting}
            className="w-full p-2 border border-gray-300 text-gray-900 rounded disabled:bg-gray-100"
          />
        </div>
      )}

      {/* Word Bank Review Mode (Word -> Def) */}
      {type === 'wordbank_review' && currentData.word && (
        <div>
          <p className="text-lg font-semibold text-gray-700 mb-2">
            {t('common.word')}
            <SpeakButton text={currentData.word} langCode={currentData.targetLanguage} isAudioLoading={isAudioLoading} onSpeak={onSpeak} t={t} />
          </p>
          <p className="p-3 bg-gray-100 text-gray-900 rounded mb-4 text-xl font-bold">{currentData.word}</p>
        </div>
      )}

      {/* Grammar Quiz (and Standalone) */}
      {(type === 'grammar' || type === 'grammar_standalone') && currentData.question && (
        <div>
          <p className="text-lg font-semibold text-gray-700 mb-3">
            {currentData.question}
            <SpeakButton text={currentData.question} langCode={uiLanguage} isAudioLoading={isAudioLoading} onSpeak={onSpeak} t={t} />
          </p>
          <div className="space-y-2">
            {currentData.options?.map((option: string, i: number) => {
              const optionLetter = String.fromCharCode(65 + i);
              let buttonClass = "text-gray-900 w-full text-left p-3 border rounded transition duration-150 ";
              const isSelected = userAnswer === optionLetter;

              if (isGraded) {
                if (optionLetter === currentData.correctAnswer) {
                  buttonClass += "bg-green-300 border-green-400";
                } else if (isSelected && !feedback.isCorrect) {
                  buttonClass += "bg-red-200 border-red-400";
                } else {
                  buttonClass += "bg-gray-200 border-gray-300 opacity-70";
                }
              } else {
                buttonClass += isSelected
                                ? "bg-blue-300 border-blue-400"
                                : "bg-white border-gray-300 hover:bg-gray-50";
              }

              return (
                <button
                  key={optionLetter}
                  onClick={() => onAnswerChange(optionLetter)}
                  disabled={isGraded || isSubmitting}
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
      {type === 'comprehension' && currentData.question && (
        <div>
          <p className="text-lg font-semibold text-gray-700 mb-3">
            {currentData.question}
            <SpeakButton text={currentData.question} langCode={uiLanguage} isAudioLoading={isAudioLoading} onSpeak={onSpeak} t={t} />
          </p>
          <textarea
            value={String(userAnswer ?? '')}
            onChange={(e) => onAnswerChange(e.target.value)}
            disabled={isGraded || isSubmitting}
            rows={4}
            className="w-full p-2 border border-gray-300 text-gray-900 rounded disabled:bg-gray-100"
            placeholder={t('activity.typeAnswer')}
          />
        </div>
      )}

      {/* Writing Practice (and Standalone) */}
      {(type === 'writing' || type === 'writing_standalone') && currentData.prompt && (
        <div>
          <p className="text-lg font-semibold text-gray-700 mb-2">
            {t('activity.writingPrompt')}
            <SpeakButton text={currentData.prompt} langCode={uiLanguage} isAudioLoading={isAudioLoading} onSpeak={onSpeak} t={t} />
          </p>
          <MarkdownRenderer content={currentData.prompt} className="p-3 bg-gray-100 text-gray-900 rounded mb-2"/>
          {currentData.vocabularyHint && (
            <p className="text-sm text-gray-600 mb-3">
              {t('activity.tryWords', { words: currentData.vocabularyHint })}
            </p>
          )}
          <textarea
            value={String(userAnswer ?? '')}
            onChange={(e) => onAnswerChange(e.target.value)}
            disabled={isGraded || isSubmitting}
            rows={6}
            className="w-full p-2 border border-gray-300 text-gray-900 rounded disabled:bg-gray-100"
            placeholder={t('activity.writeResponse')}
          />
        </div>
      )}
    </div>
  );
};