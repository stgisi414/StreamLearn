// stgisi414/streamlearn/StreamLearn-5da6eca49904e01182e33e017b9792764ef017c0/components/LiveChatTab.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Lesson, LanguageCode } from '../types';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from './LoadingSpinner';
import { GoogleGenAI, Modality, Session, LiveServerMessage } from '@google/genai';
import { AudioRecorder } from '@/lib/audio-recorder';
import { AudioStreamer } from '@/lib/audio-streamer';
import { arrayBufferToBase64 } from '@/lib/utils';

// --- LOGGING ---
const LOG_PREFIX = '[DEBUG_LIVE_TAB_NEW]';
console.log(`${LOG_PREFIX} File loaded.`);

interface LiveChatTabProps {
  lesson: Lesson;
  uiLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  geminiApiKey: string; // We now take the API key directly
  liveChatUsageCount: number | null; // <-- ADD THIS
  isUsageLoading: boolean; // <-- ADD THIS
  onIncrementLiveChatUsage: () => Promise<void>; // <-- ADD THIS
}

// --- HELPER FUNCTIONS ---
const getSimpleLanguageName = (code: LanguageCode | string): string => {
  switch (code) {
    case "en": return "English";
    case "es": return "Spanish";
    case "fr": return "French";
    case "de": return "German";
    case "it": return "Italian";
    case "ko": return "Korean";
    case "ja": return "Japanese";
    case "zh": return "Chinese";
    case "ar": return "Arabic";
    case "ru": return "Russian";
    case "hi": return "Hindi";
    case "pl": return "Polish";
    case "vi": return "Vietnamese";
    case "pt": return "Portuguese";
    case "id": return "Indonesian";
    case "th": return "Thai";
    default: return "English"; // Fallback
  }
};

/**
 * Maps app language codes to Google's IETF BCP-47 language codes
 * for the Gemini Live API speechConfig.
 */
const getBcp47LanguageCode = (code: LanguageCode | string): string => {
  switch (code) {
    case "en": return "en-US";
    case "es": return "es-US";
    case "fr": return "fr-FR";
    case "de": return "de-DE";
    case "it": return "it-IT";
    case "ko": return "ko-KR";
    case "ja": return "ja-JP";
    case "zh": return "cmn-CN"; // Mandarin
    case "ar": return "ar-XA"; // Standard Arabic
    case "ru": return "ru-RU";
    case "hi": return "hi-IN";
    case "pl": return "pl-PL";
    case "vi": return "vi-VN";
    case "pt": return "pt-BR";
    case "id": return "id-ID";
    case "th": return "th-TH";
    default: return "en-US"; // Fallback
  }
};
// --- END HELPER FUNCTIONS ---

export const LiveChatTab: React.FC<LiveChatTabProps> = React.memo(({
  lesson,
  uiLanguage,
  targetLanguage,
  geminiApiKey,
  liveChatUsageCount,
  isUsageLoading,
  onIncrementLiveChatUsage
}) => {
  console.log(`${LOG_PREFIX} LiveChatTab component rendering...`);
  const { t } = useTranslation();

  // --- State ---
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conversationLog, setConversationLog] = useState<string>("");
  const [interimLog, setInterimLog] = useState<string>("");

  // --- Refs ---
  const aiRef = useRef<GoogleGenAI | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const streamerRef = useRef<AudioStreamer | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // This ref holds the response queue from the Google example
  const responseQueueRef = useRef<LiveServerMessage[]>([]);

  // --- NEW: Ref for session timer ---
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const SESSION_DURATION_MS = 300000; // 5 minutes

  // Auto-scroll for transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationLog, interimLog]);

  // --- System Prompt Builder ---
  const getSystemPrompt = useCallback(() => {
    console.log(`${LOG_PREFIX} getSystemPrompt called.`);
    const uiLangName = getSimpleLanguageName(uiLanguage);
    const targetLangName = getSimpleLanguageName(targetLanguage);
    const vocabList = lesson.vocabularyList.map((v: any) =>
      `- ${v.word} (${targetLangName}): ${v.definition} (${uiLangName}). Example: "${v.articleExample}"`
    ).join('\n');
    const comprehensionQuestions = lesson.comprehensionQuestions.join('\n- ');

    // This is the system prompt from the Google example, customized with our lesson
    return `
You are "Max," a friendly, patient, and expert language tutor.
You are helping a student who is learning ${targetLangName} and speaks ${uiLangName}.
Your entire knowledge base for this conversation is STRICTLY limited to the following lesson data:
--- START LESSON DATA ---
Article Title (${targetLangName}): ${lesson.articleTitle}
Summary (${targetLangName}): ${lesson.summary}
Vocabulary List: ${vocabList}
Grammar Focus (${uiLangName} explanation):
- Topic: ${lesson.grammarFocus.topic}
- Explanation: ${lesson.grammarFocus.explanation}
Comprehension Questions (${uiLangName}):
- ${comprehensionQuestions}
--- END LESSON DATA ---
YOUR ROLE AND RULES:
1.  You are conversational and helpful in *both* ${uiLangName} and ${targetLangName}.
2.  Your primary goal is to help the user understand the lesson.
3.  **CRITICAL RULE:** If the user asks a question *outside* the scope of this lesson, you MUST politely decline and guide them back to the lesson.
4.  Keep your answers concise and easy to understand.
5.  You MUST respond with both TEXT AND AUDIO.
6.  You MUST use a standard, male-sounding voice for all your audio responses.`;
  }, [lesson, uiLanguage, targetLanguage]);


  /**
   * This function is adapted from the Google doc example.
   * It waits for the next message in the queue.
   */
  const waitMessage = async (): Promise<LiveServerMessage> => {
    let done = false;
    let message: LiveServerMessage | undefined = undefined;
    while (!done) {
        message = responseQueueRef.current.shift();
        if (message) {
            done = true;
        } else {
            // Wait 100ms for a new message
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    return message!;
  }

  /**
   * This function is adapted from the Google doc example.
   * It processes messages until a 'turnComplete' signal is received.
   */
  const handleTurn = async () => {
    console.log(`${LOG_PREFIX} handleTurn: Waiting for messages...`);
    const turns = [];
    let done = false;
    while (!done) {
        const message = await waitMessage();
        console.log(`${LOG_PREFIX} handleTurn: Dequeued message:`, message);
        turns.push(message);

        // --- Process messages as they come in ---
        
        // Handle input transcription
        if (message.serverContent?.inputTranscription) {
          const trans = message.serverContent.inputTranscription;
          const isFinal = (trans as any).isFinal ?? false;
           if (isFinal) {
              setConversationLog(prev => prev + `USER: ${trans.text}\n`);
              setInterimLog("");
            } else {
              setInterimLog(`USER: ${trans.text}`);
            }
        }
        
        // Handle output transcription
        if (message.serverContent?.outputTranscription) {
            const trans = message.serverContent.outputTranscription;
            const isFinal = (trans as any).isFinal ?? false;
            setConversationLog(prev => { 
              let newLog;
              if (prev.endsWith('\n') || prev.length === 0) {
                newLog = prev + `MAX: ${trans.text}` + (isFinal ? '\n' : '');
              } else {
                const lastNewline = prev.lastIndexOf('\n');
                const base = prev.substring(0, lastNewline + 1);
                newLog = base + `MAX: ${trans.text}` + (isFinal ? '\n' : '');
              }
              return newLog;
            });
        }
        
        // Handle audio data
        if (message.data) {
           console.log(`${LOG_PREFIX} handleTurn: Got audio data chunk.`);
           // The data is base64 16-bit PCM. Our new streamer handles this.
           streamerRef.current?.addAudio(message.data);
        }

        // Check if the turn is complete
        if (message.serverContent && message.serverContent.turnComplete) {
            console.log(`${LOG_PREFIX} handleTurn: Turn complete.`);
            done = true;
        }
    }
    return turns;
  }

  // --- Main Cleanup Function ---
  const cleanupConnection = useCallback(() => {
    console.log(`${LOG_PREFIX} cleanupConnection called.`);

    // --- NEW: Clear session timer ---
    if (sessionTimerRef.current) {
      console.log(`${LOG_PREFIX} cleanupConnection: Clearing session timer.`);
      clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    
    if (sessionRef.current) {
      console.log(`${LOG_PREFIX} cleanupConnection: Disconnecting client...`);
      sessionRef.current.close();
      sessionRef.current = null;
    }
    
    if (recorderRef.current) {
      console.log(`${LOG_PREFIX} cleanupConnection: Stopping recorder...`);
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    
    if (streamerRef.current) {
      console.log(`${LOG_PREFIX} cleanupConnection: Stopping streamer...`);
      streamerRef.current.stop();
      streamerRef.current = null;
    }

    responseQueueRef.current = []; // Clear message queue
    setIsSessionActive(false);
    setIsConnecting(false);
    setInterimLog("");
    console.log(`${LOG_PREFIX} cleanupConnection: States set.`);
  }, []);

  // --- Start/Stop Handler ---
  const handleToggleConnection = async () => {
    console.log(`${LOG_PREFIX} handleToggleConnection called.`);

    // --- STOPPING ---
    if (isSessionActive || isConnecting) {
      console.log(`${LOG_PREFIX} handleToggleConnection: STOPPING connection.`);
      cleanupConnection();
      return;
    }

    // --- STARTING ---
    console.log(`${LOG_PREFIX} handleToggleConnection: STARTING connection.`);
    setIsConnecting(true);
    setErrorMessage(null);
    setConversationLog("");
    setInterimLog("");
    responseQueueRef.current = [];

    try {
      // --- NEW: Check usage limit before starting ---
      if (isUsageLoading) {
        console.log(`${LOG_PREFIX} handleToggleConnection: Usage data is still loading.`);
        setErrorMessage("Checking usage limit...");
        setIsConnecting(false); // Not connecting yet
        return;
      }
      
      if (liveChatUsageCount === null || liveChatUsageCount >= 3) {
        console.log(`${LOG_PREFIX} handleToggleConnection: User has reached daily limit.`);
        setErrorMessage(t('chat.liveLimitReached'));
        setIsConnecting(false);
        return;
      }
      // --- END: Check usage limit ---

      // 1. Init SDK (as per doc example)
      if (!aiRef.current) {
          if (!geminiApiKey) {
            console.error(`${LOG_PREFIX} FATAL: Gemini API Key is missing.`);
            throw new Error("Gemini API Key is not configured.");
          }
          // WARNING: Do not use API keys in client-side (browser based) applications
          // Consider using Ephemeral Tokens instead
          // More information at: https://ai.google.dev/gemini-api/docs/ephemeral-tokens
          aiRef.current = new GoogleGenAI({ apiKey: geminiApiKey });
          console.log(`${LOG_PREFIX} GoogleGenAI client initialized.`);
      }
      
      // 2. Init Audio Recorder and Streamer
      recorderRef.current = new AudioRecorder(16000); // 16kHz input
      streamerRef.current = new AudioStreamer(); // 24kHz output
      console.log(`${LOG_PREFIX} AudioRecorder and AudioStreamer initialized.`);

      // 3. Define Model and Config (as per doc example)
      const model = "gemini-2.5-flash-native-audio-preview-09-2025";
      const config = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }, // Use "Kore" (male) as you found
          languageCode: getBcp47LanguageCode(targetLanguage) // Map 'ko' -> 'ko-KR', etc.
        },
        systemInstruction: { parts: [{ text: getSystemPrompt() }] },
      };
      console.log(`${LOG_PREFIX} Model and Config defined.`);
      console.log("[DEBUG]: Configuration settings");
      console.log(config);

      // 4. Connect
      // --- NEW: Increment usage *before* connecting ---
      try {
        await onIncrementLiveChatUsage();
        console.log(`${LOG_PREFIX} Successfully incremented live chat usage.`);
      } catch (e) {
        console.error(`${LOG_PREFIX} Failed to increment usage:`, e);
        throw new Error("Could not update your usage count. Please try again.");
      }
      // --- END: Increment usage ---
      console.log(`${LOG_PREFIX} Calling ai.live.connect...`);
      sessionRef.current = await aiRef.current.live.connect({
        model: model,
        config: config,
        callbacks: {
          onopen: () => {
            console.log(`${LOG_PREFIX} client.on('open'): FIRED.`);
            setIsConnecting(false);
            setIsSessionActive(true);

            // --- NEW: Start 5-minute session timer ---
            console.log(`${LOG_PREFIX} Starting ${SESSION_DURATION_MS}ms session timer.`);
            if (sessionTimerRef.current) {
              clearTimeout(sessionTimerRef.current); // Clear just in case
            }
            sessionTimerRef.current = setTimeout(() => {
              console.warn(`${LOG_PREFIX} Session timer FIRED. Forcing disconnect.`);
              // NOTE: We can't use t() here as it might be stale. Hardcode or pass t() into useCallback.
              setErrorMessage("Session limit reached (5 minutes). Please start a new session.");
              cleanupConnection();
            }, SESSION_DURATION_MS);
          },
          onmessage: (message: LiveServerMessage) => {
            // console.log(`${LOG_PREFIX} client.on('message'): Received message, pushing to queue.`); // Too noisy
            responseQueueRef.current.push(message);
          },
          onerror: (e: ErrorEvent) => {
            console.error(`${LOG_PREFIX} client.on('error'): FIRED.`, e);
            setErrorMessage(e.message || "An unknown connection error occurred.");
            cleanupConnection();
          },
          onclose: (e: CloseEvent) => {
            console.log(`${LOG_PREFIX} client.on('close'): FIRED. Reason: ${e.reason} Code: ${e.code}`);
            if (e.code !== 1000) { // 1000 is normal closure
               setErrorMessage(`Connection closed: ${e.reason} (Code: ${e.code})`);
            }
            cleanupConnection();
          },
        },
      });
      console.log(`${LOG_PREFIX} ai.live.connect() promise resolved.`);

      // 5. Start Audio Recorder and pipe to Gemini
      recorderRef.current.on('data', (arrayBuffer: ArrayBuffer) => {
          if (sessionRef.current) {
            
            // --- THIS IS THE FIX ---
            // Convert the ArrayBuffer to a base64 string
            const base64Audio = arrayBufferToBase64(arrayBuffer);

            // Send in the exact format from the documentation
            sessionRef.current.sendRealtimeInput({
                audio: {
                    data: base64Audio,
                    mimeType: "audio/pcm;rate=16000"
                }
            });
            // --- END FIX ---
          }
      });
      
      await recorderRef.current.start();
      console.log(`${LOG_PREFIX} Recorder started.`);

      // 6. Start the message processing loop
      console.log(`${LOG_PREFIX} Starting main processing loop (handleTurn).`);
      // Run in a non-blocking way
      (async () => {
          while (sessionRef.current) {
             try {
                await handleTurn();
             } catch (e) {
                console.error(`${LOG_PREFIX} Error in handleTurn loop:`, e);
                // If session is still active, this was a processing error
                if (sessionRef.current) {
                   setErrorMessage(`Error processing response: ${(e as Error).message}`);
                }
                // If session is null, cleanupConnection was already called
                break;
             }
          }
          console.log(`${LOG_PREFIX} Main processing loop exited.`);
      })();

    } catch (e) {
      const msg = (e as Error).message;
      console.error(`${LOG_PREFIX} handleToggleConnection: STARTUP FAILED (catch block):`, e);
      if (msg.includes("Permission denied") || msg.includes("denied")) {
        setErrorMessage(t('chat.liveMicError'));
      } else {
        setErrorMessage(`Failed to start: ${msg}`);
      }
      cleanupConnection();
    }
  };

  // --- Unmount Cleanup ---
  useEffect(() => {
    console.log(`${LOG_PREFIX} useEffect [unmount] setup.`);
    return () => {
      console.log(`${LOG_PREFIX} useEffect [unmount]: Component unmounting, running cleanup...`);
      cleanupConnection();
    };
  }, [cleanupConnection]); // Dependency array includes the stable cleanup function

  // --- RENDER ---
  return (
    <div className="space-y-4 text-center">
      {/* --- NEW: Show remaining count or loading state --- */}
      {isUsageLoading ? (
         <p className="text-sm text-gray-500 italic">{t('common.loading')}</p>
      ) : (
        <p className="text-sm text-gray-700">
          {isSessionActive 
            ? "I'm listening..." 
            : (liveChatUsageCount !== null && liveChatUsageCount < 3)
              ? t('chat.liveWelcome')
              : t('chat.liveLimitReached')
          }
          {(liveChatUsageCount !== null && liveChatUsageCount < 3 && !isSessionActive) && (
            <span className="block text-xs text-gray-500 mt-1">
              {t('chat.liveSessionsRemaining', { count: 3 - liveChatUsageCount })}
            </span>
          )}
        </p>
      )}

      {isConnecting ? (
        <LoadingSpinner text={t('chat.liveLoading')} />
      ) : (
      <button
        onClick={handleToggleConnection}
        disabled={isUsageLoading || (liveChatUsageCount !== null && liveChatUsageCount >= 3 && !isSessionActive)}
        className={`font-bold py-3 px-6 rounded-lg text-white transition-all ${
          isSessionActive
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed'
        }`}
      >
        {isSessionActive ? t('chat.liveStop') : t('chat.liveStart')}
      </button>
    )}
      {errorMessage && (
        <p className="text-sm text-red-600 mt-2">{errorMessage}</p>
      )}

      {/* Transcript Area */}
      {(isSessionActive || isConnecting || conversationLog || interimLog) && (
        <div
          className="mt-4 text-left p-3 bg-white border border-indigo-200 rounded-lg h-32 overflow-y-auto whitespace-pre-wrap"
        >
          {conversationLog}
          {interimLog && (
            <span className="text-gray-400">{interimLog}</span>
          )}
          {(!conversationLog && !interimLog && isSessionActive) && (
            <span className="text-gray-400">Listening...</span>
          )}
          <div ref={transcriptEndRef} />
        </div>
      )}
    </div>
  );
});