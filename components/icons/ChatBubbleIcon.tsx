import React from 'react';

// A "Sparkles" icon, often used for AI
export const ChatBubbleIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-3.86 8.25-8.625 8.25a8.61 8.61 0 0 1-1.631-.22c-.412-.083-.823-.153-1.243-.217-.42-.064-.84-.118-1.27-.162a8.61 8.61 0 0 1-1.631-.22C3.86 20.25 0 16.556 0 12c0-4.556 3.86-8.25 8.625-8.25.412.083.823.153 1.243.217.42.064.84.118 1.27.162a8.61 8.61 0 0 1 1.631.22c4.765.98 8.625 4.694 8.625 8.25Z" />
  </svg>
);