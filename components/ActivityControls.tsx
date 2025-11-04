import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityState } from '../types';
import { LoadingSpinner } from './LoadingSpinner';

interface ActivityControlsProps {
  activityState: ActivityState;
  onSubmit: () => void;
  onNext: () => void;
  isLastStep: boolean;
}

export const ActivityControls: React.FC<ActivityControlsProps> = ({
  activityState,
  onSubmit,
  onNext,
  isLastStep
}) => {
  const { t } = useTranslation();
  const { userAnswer, feedback, isSubmitting, type } = activityState;

  const isGraded = feedback.isCorrect !== null;
  const canSubmit = (type === 'wordbank_review' || (userAnswer !== null && userAnswer !== '')) && !isSubmitting;

  return (
    <div className="mt-6 flex justify-end gap-3">
      {!isGraded ? (
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="bg-blue-600 text-white font-bold py-2 px-5 rounded-lg hover:bg-blue-700 transition duration-150 disabled:opacity-50"
        >
          {isSubmitting ? (
            <LoadingSpinner className="w-5 h-5 inline-block" />
          ) : type === 'wordbank_review' ? (
            t('activity.showDefinition')
          ) : (
            t('common.submit')
          )}
        </button>
      ) : (
        <button
          onClick={onNext}
          className="bg-gray-600 text-white font-bold py-2 px-5 rounded-lg hover:bg-gray-700 transition duration-150"
        >
          {isLastStep ? t('common.finish') : t('common.next')}
        </button>
      )}
    </div>
  );
};