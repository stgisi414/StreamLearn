import React from 'react';

// Icon for "Practice Lab" / "Practice Center"
export const BeakerIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75 16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0 0 20.25 18V9.75A2.25 2.25 0 0 0 18 7.5H6A2.25 2.25 0 0 0 3.75 9.75v8.5A2.25 2.25 0 0 0 6 20.25Z" />
  </svg>
);