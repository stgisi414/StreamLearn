import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageCode, PracticeTopic, PracticeTopicType } from '../types';
import { grammarData, vocabData, conversationData } from '../practiceData'; // Import the new data
import { LoadingSpinner } from './LoadingSpinner';
import { BeakerIcon } from './icons/BeakerIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { BrainIcon } from './icons/BrainIcon';
import { SearchIcon } from './icons/SearchIcon';

interface PracticeCenterProps {
  isOpen: boolean;
  onClose: () => void;
  onStartPractice: (type: PracticeTopicType, topic: PracticeTopic) => void;
  targetLanguage: LanguageCode;
}

export const PracticeCenter: React.FC<PracticeCenterProps> = ({
  isOpen,
  onClose,
  onStartPractice,
  targetLanguage,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<PracticeTopicType>('grammar');
  const [level, setLevel] = useState<number>(1); // Default to Beginner (Level 1)
  const [searchTerm, setSearchTerm] = useState('');

  // Get the correct data source based on the active tab
  const topicData = useMemo(() => {
    switch (activeTab) {
      case 'grammar':
        return grammarData[targetLanguage] || [];
      case 'writing':
        // Use conversation data for writing prompts
        return conversationData[targetLanguage] || [];
      case 'vocab':
        return vocabData || [];
    }
  }, [activeTab, targetLanguage]);

  // Filter topics based on selected level and search term
  const filteredTopics = useMemo(() => {
    const lowerSearch = searchTerm.toLowerCase();
    return topicData.filter(topic => {
      const titleMatch = topic.title.toLowerCase().includes(lowerSearch);
      const tagMatch = topic.tags.some((tag: string) => tag.toLowerCase().includes(lowerSearch));
      const levelMatch = topic.level === level;
      return levelMatch && (titleMatch || tagMatch);
    });
  }, [topicData, level, searchTerm]);

  if (!isOpen) return null;

  const handleStart = (topic: PracticeTopic) => {
    onStartPractice(activeTab, topic);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-center items-end md:items-center p-0 md:p-4"
      onClick={onClose}
    >
      <div 
        className="w-full md:w-full md:max-w-2xl bg-white rounded-t-xl md:rounded-xl shadow-2xl space-y-4 p-4 md:p-6 flex flex-col max-h-[85vh] md:max-h-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center shrink-0">
          <h2 className="text-xl md:text-2xl font-bold text-gray-800">{t('dashboard.practiceCenter')}</h2>
          <button onClick={onClose} className="p-2 -mr-2 text-gray-400 hover:text-gray-600">&times;</button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b overflow-x-auto shrink-0">
          <TabButton
            icon={<PencilSquareIcon className="w-5 h-5" />}
            label={t('dashboard.grammarPractice')}
            isActive={activeTab === 'grammar'}
            onClick={() => setActiveTab('grammar')}
          />
          <TabButton
            icon={<BrainIcon className="w-5 h-5" />}
            label={t('dashboard.writingPractice')}
            isActive={activeTab === 'writing'}
            onClick={() => setActiveTab('writing')}
          />
          <TabButton
            icon={<BeakerIcon className="w-5 h-5" />}
            label={t('wordBank.practiceTitle')}
            isActive={activeTab === 'vocab'}
            onClick={() => setActiveTab('vocab')}
          />
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
          {/* Level Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.level')}</label>
            <select
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              className="w-full p-2 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value={1}>{t('common.beginner')} (Level 1)</option>
              <option value={2}>{t('common.intermediate')} (Level 2)</option>
              <option value={3}>Intermediate (Level 3)</option>
              <option value={4}>{t('common.advanced')} (Level 4)</option>
              <option value={5}>Advanced (Level 5)</option>
            </select>
          </div>
          {/* Search Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.search')}</label>
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('dashboard.historySearch')}
                className="w-full p-2 pl-10 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
              />
              <SearchIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>
        </div>

        {/* Topic List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-2 min-h-0">
          {filteredTopics.length > 0 ? (
            filteredTopics.map((topic) => (
              <button
                key={topic.title}
                onClick={() => handleStart(topic)}
                className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-blue-100 border border-gray-200 hover:border-blue-300 transition"
              >
                <span className="font-medium text-gray-800">{topic.title}</span>
                <div className="text-xs text-gray-500 mt-1">
                  {topic.tags.map(tag => `#${tag}`).join(' ')}
                </div>
              </button>
            ))
          ) : (
            <p className="text-center text-gray-500 py-4">{t('dashboard.historyNoResults', { term: searchTerm })}</p>
          )}
        </div>
      </div>
    </div>
  );
};

// Helper component for the tabs
const TabButton: React.FC<{icon: React.ReactNode, label: string, isActive: boolean, onClick: () => void}> = 
  ({ icon, label, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap
      ${isActive 
        ? 'border-blue-600 text-blue-600' 
        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }
    `}
  >
    {icon}
    {label}
  </button>
);