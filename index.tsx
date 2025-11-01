// index.tsx
// --- NEW SCRIPT FOR BROWSER REDIRECTION ---
// This script runs immediately to handle redirects for both iOS and Android.
(function() {
  const userAgent = window.navigator.userAgent.toLowerCase();
  const currentUrl = window.location.href;
  
  // Check for iOS devices
  const isIos = userAgent.includes('iphone') || userAgent.includes('ipad');
  if (isIos) {
    const isNaverIOS = userAgent.includes('naver(inapp;');
    // Correctly allows Chrome ('crios') and Safari
    const isGenericIOSWebView = !userAgent.includes('safari') && !userAgent.includes('crios');
    if (isNaverIOS || isGenericIOSWebView) {
      window.location.href = 'x-safari-' + currentUrl;
      return;
    }
  }

  // Check for Android devices
  const isAndroid = userAgent.includes('android');
  if (isAndroid) {
    const isNaverAndroid = userAgent.includes('naver');
    const isGenericAndroidWebView = userAgent.includes('wv');

    if (isNaverAndroid || isGenericAndroidWebView) {
      // Android Intent to force open in Chrome
      const intentUrl = currentUrl.replace(/https?:\/\//, 'intent://');
      window.location.href = `${intentUrl}#Intent;scheme=https;package=com.android.chrome;end`;
    }
  }
})();

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';
import { LoadingSpinner } from './components/LoadingSpinner';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  // <React.StrictMode> // FIX: Comment this out
    <React.Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <LoadingSpinner text="Loading..." />
      </div>
    }>
      <App />
    </React.Suspense>
  // </React.StrictMode> // FIX: Comment this out
);