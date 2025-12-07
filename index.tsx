import React from 'react';
import './index.css';
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