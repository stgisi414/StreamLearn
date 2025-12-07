import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export const InAppBrowserOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);

  useEffect(() => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    
    // Check for iOS In-App Browsers (exclude Safari and Chrome)
    const isIos = userAgent.includes('iphone') || userAgent.includes('ipad');
    let detected = false;

    if (isIos) {
      const isNaverIOS = userAgent.includes('naver(inapp;');
      const isGenericIOSWebView = !userAgent.includes('safari') && !userAgent.includes('crios'); // 'crios' is Chrome on iOS
      if (isNaverIOS || isGenericIOSWebView) {
        detected = true;
      }
    } 
    // Check for Android In-App Browsers
    else if (userAgent.includes('android')) {
      const isNaverAndroid = userAgent.includes('naver');
      const isGenericAndroidWebView = userAgent.includes('wv');
      if (isNaverAndroid || isGenericAndroidWebView || userAgent.includes('instagram') || userAgent.includes('fbav') || userAgent.includes('line')) {
        detected = true;
      }
    }

    setIsInAppBrowser(detected);
  }, []);

  const handleOpenInSystemBrowser = () => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const currentUrl = window.location.href;

    if (userAgent.includes('iphone') || userAgent.includes('ipad')) {
      // iOS: Try x-safari- scheme
      window.location.href = 'x-safari-' + currentUrl;
    } else if (userAgent.includes('android')) {
        // Android: Intent scheme
        const intentUrl = currentUrl.replace(/https?:\/\//, 'intent://');
        window.location.href = `${intentUrl}#Intent;scheme=https;package=com.android.chrome;end`;
    } else {
        // Fallback for others
        window.open(currentUrl, '_system');
    }
  };

  if (!isInAppBrowser) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-95 p-4 text-center">
      <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-2xl space-y-4">
        <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-blue-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S13.632 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.632 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
        </div>
        
        <h3 className="text-xl font-bold text-gray-800">
          {t('common.openInBrowser') || "Open in System Browser"}
        </h3>
        
        <p className="text-gray-600 text-sm">
           {t('common.inAppBrowserMessage') || "For the best experience and to sign in, please open this page in your default browser (Chrome or Safari)."}
        </p>

        <button
          onClick={handleOpenInSystemBrowser}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition shadow-lg flex items-center justify-center gap-2"
        >
          <span>Open Browser</span>
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </button>
        
        <button 
            onClick={() => setIsInAppBrowser(false)}
            className="text-gray-400 text-xs underline hover:text-gray-600 mt-2"
        >
            Continue anyway (Login may fail)
        </button>
      </div>
    </div>
  );
};
