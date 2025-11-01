import React, { useState, useRef, useEffect } from 'react';
import { Lesson, LanguageCode, ChatMessage } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { ChatBubbleIcon } from './icons/ChatBubbleIcon';
import { useTranslation } from 'react-i18next';
import { LiveChatTab } from './LiveChatTab'; // <-- Import the new tab component

interface ChatAssistantProps {
  lesson: Lesson;
  uiLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  history: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  onSubmit: (input: string) => Promise<void>;
  onClearChat: () => void;
  fetchAuthToken: () => Promise<string>;
  geminiApiKey: string; // <-- ADD THIS
}

const TextChatTab: React.FC<Omit<ChatAssistantProps, 'fetchAuthToken' | 'lesson' | 'geminiApiKey'>> = React.memo(({
  history,
  isLoading,
  error,
  onSubmit,
  onClearChat,
  uiLanguage,
  targetLanguage
}) => {
  const textRenderCount = useRef(0); // DEBUG
  textRenderCount.current += 1; // DEBUG
  console.log(`DEBUG_CHAT_TEXT: Render #${textRenderCount.current}`);

  const { t } = useTranslation();
  const [userInput, setUserInput] = useState('');
  const chatBodyRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when history changes
  React.useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [history, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userInput.trim()) {
      onSubmit(userInput.trim());
      setUserInput('');
    }
  };

  const getLanguageName = (code: LanguageCode): string => t(`languages.${code}`);

  const welcomeMessage: ChatMessage = {
    role: 'model',
    text: t('chat.welcome', { 
      targetLang: getLanguageName(targetLanguage), 
      uiLang: getLanguageName(uiLanguage) 
    })
  };
  
  const displayHistory = history.length > 0 ? history : [welcomeMessage];

  return (
    <div className="space-y-3">
      {/* Chat History Window */}
      <div 
        ref={chatBodyRef} 
        className="h-64 overflow-y-auto bg-white border border-indigo-200 rounded-lg p-3 space-y-3"
      >
        {displayHistory.map((msg, index) => (
          <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div 
              className={`max-w-[80%] p-3 rounded-xl whitespace-pre-wrap ${
                msg.role === 'user' 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-200 text-gray-800'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-200 text-gray-500 p-3 rounded-xl inline-flex items-center gap-2">
              <LoadingSpinner className="w-4 h-4 inline-block" />
              <span>Max is typing...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder={t('chat.placeholder')}
          className="flex-grow p-3 border border-gray-300 text-gray-900 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !userInput.trim()}
          className="bg-indigo-600 text-white font-bold py-3 px-5 rounded-lg hover:bg-indigo-700 transition duration-150 shadow-lg disabled:opacity-50"
        >
          {t('chat.send')}
        </button>
      </form>
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  );
});


export const ChatAssistant: React.FC<ChatAssistantProps> = React.memo((props) => {
  const assistantRenderCount = useRef(0); // DEBUG
  assistantRenderCount.current += 1; // DEBUG
  console.log(`DEBUG_CHAT_ASSISTANT: Render #${assistantRenderCount.current}`);

  // DEBUG: Log prop changes
  useEffect(() => {
    console.log("DEBUG_CHAT_ASSISTANT: Props changed (or component mounted)");
  }, [props.lesson, props.history, props.isLoading, props.error, props.onSubmit, props.onClearChat, props.fetchAuthToken]);

  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'text' | 'live'>('text');

  const getTabClass = (tabName: 'text' | 'live') => {
    const isActive = activeTab === tabName;
    return `py-2 px-4 font-medium rounded-t-lg ${
      isActive 
        ? 'bg-white text-indigo-700 border-b-0' 
        : 'bg-transparent text-indigo-400 hover:bg-indigo-100/50'
    }`;
  };

  return (
    <div className="space-y-3 border-l-4 border-indigo-500 pl-4 bg-indigo-50 p-4 rounded-lg">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold text-indigo-700 flex items-center gap-2">
          <ChatBubbleIcon className="w-6 h-6" />
          {t('chat.title')}
        </h3>
        {activeTab === 'text' && props.history.length > 0 && (
          <button
            onClick={props.onClearChat}
            disabled={props.isLoading}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
          >
            {t('chat.clearChat')}
          </button>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-indigo-300">
        <button 
          onClick={() => setActiveTab('text')} 
          className={getTabClass('text')}
        >
          {t('chat.tabText')}
        </button>
        <button 
          onClick={() => setActiveTab('live')} 
          className={getTabClass('live')}
        >
          {t('chat.tabLive')}
        </button>
      </div>

      {/* Tab Content */}
      <div className="pt-2">
        {activeTab === 'text' && (
          <TextChatTab
            history={props.history}
            isLoading={props.isLoading}
            error={props.error}
            onSubmit={props.onSubmit}
            onClearChat={props.onClearChat}
            uiLanguage={props.uiLanguage}
            targetLanguage={props.targetLanguage}
          />
        )}
        {activeTab === 'live' && (
          <LiveChatTab
            lesson={props.lesson}
            uiLanguage={props.uiLanguage}
            targetLanguage={props.targetLanguage}
            // --- CHANGE IS HERE ---
            // fetchAuthToken={props.fetchAuthToken} // <-- REMOVE THIS
            geminiApiKey={props.geminiApiKey}     // <-- ADD THIS
            // --- END CHANGE ---
          />
        )}
      </div>
    </div>
  );
});