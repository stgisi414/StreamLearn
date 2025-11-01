import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Lesson, LanguageCode } from '../types';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from './LoadingSpinner';
import { GoogleGenAI, Modality } from '@google/genai'; // Removed unused Content

interface LiveChatTabProps {
  lesson: Lesson;
  uiLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  fetchAuthToken: () => Promise<string>; 
}

const TARGET_SAMPLE_RATE = 16000;
const INCOMING_SAMPLE_RATE = 24000;

export const LiveChatTab: React.FC<LiveChatTabProps> = React.memo(({ 
  lesson, 
  uiLanguage, 
  targetLanguage, 
  fetchAuthToken 
}) => {
  
  // DEBUG: Component Render Log
  const renderCount = useRef(0);
  renderCount.current += 1;
  const [isListening, setIsListening] = useState(false);
  console.log(`%cDEBUG_LIVE_TAB: Render #${renderCount.current} | isListening (state): ${isListening}`, 'color: #00aaff');

  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");

  const sessionRef = useRef<any | null>(null);
  const isListeningRef = useRef(false);
  const isSessionReadyRef = useRef(false);

  // Audio & API Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const micNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playbackQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);

  const getLanguageName = (code: LanguageCode): string => t(`languages.${code}`);

  const getSystemPrompt = useCallback(() => {
    const uiLangName = getLanguageName(uiLanguage);
    const targetLangName = getLanguageName(targetLanguage);
    const vocabList = lesson.vocabularyList.map((v: any) => 
      `- ${v.word} (${targetLangName}): ${v.definition} (${uiLangName}). Example: "${v.articleExample}"`
    ).join('\n');
    const comprehensionQuestions = lesson.comprehensionQuestions.join('\n- ');

    return `You are "Max," a friendly, patient, and expert language tutor.
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
5.  You MUST respond with both TEXT and AUDIO.`;
  }, [lesson, uiLanguage, targetLanguage, t]);

  const cleanupAudioResources = useCallback(() => {
    console.log("%cDEBUG_LIVE_TAB: cleanupAudioResources() CALLED", 'color: #ff0000; font-weight: bold;');
    
    if (workletNodeRef.current) {
        console.log("%cDEBUG_LIVE_TAB: Disconnecting workletNodeRef", 'color: #ff0000');
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
    }
    if (micNodeRef.current) {
        console.log("%cDEBUG_LIVE_TAB: Disconnecting micNodeRef", 'color: #ff0000');
        micNodeRef.current.disconnect();
        micNodeRef.current = null;
    }
    if (streamRef.current) {
        console.log("%cDEBUG_LIVE_TAB: Stopping media stream tracks", 'color: #ff0000');
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        console.log("%cDEBUG_LIVE_TAB: Closing AudioContext", 'color: #ff0000');
        audioContextRef.current.close().catch(e => console.warn("Error closing audio context", e));
        audioContextRef.current = null;
    }
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || playbackQueueRef.current.length === 0) {
      return;
    }
    
    isPlayingRef.current = true;
    const audioBufferRaw = playbackQueueRef.current.shift();
    if (!audioBufferRaw) {
      isPlayingRef.current = false;
      return;
    }

    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = audioContextRef.current;

      const pcmData = new Int16Array(audioBufferRaw);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768.0;
      }

      const audioBuffer = audioCtx.createBuffer(
        1, 
        floatData.length,
        INCOMING_SAMPLE_RATE 
      );
      audioBuffer.getChannelData(0).set(floatData);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      source.onended = () => {
        isPlayingRef.current = false;
        playAudioQueue(); // Play next in queue
      };
      source.start();

    } catch (e) {
      console.error("Error playing audio:", e);
      setError(`Audio playback error: ${(e as Error).message}`);
      isPlayingRef.current = false;
    }
  }, [setError]);

  const handleStartStopChat = async () => {
    const callId = `call_${Date.now()}`; // DEBUG
    console.log(`%cDEBUG_LIVE_TAB: handleStartStopChat [${callId}] | Current isListeningRef: ${isListeningRef.current}`, 'color: #ffaa00');

    if (isListeningRef.current) {
      // --- STOP LISTENING ---
      console.log(`%cDEBUG_LIVE_TAB: [${callId}] STOPPING...`, 'color: #ff0000');
      isListeningRef.current = false; 
      isSessionReadyRef.current = false;
      
      if (sessionRef.current) {
        console.log(`%cDEBUG_LIVE_TAB: [${callId}] Calling session.close()`, 'color: #ff0000');
        sessionRef.current.close(); // This will trigger onclose
      } else {
        console.log(`%cDEBUG_LIVE_TAB: [${callId}] No session to close, cleaning up manually.`, 'color: #ff0000');
        cleanupAudioResources();
        // Manually reset UI state if no session existed
        setIsListening(false);
        setIsLoading(false);
      }
      sessionRef.current = null;
      
      console.log(`%cDEBUG_LIVE_TAB: [${callId}] STOP complete. UI state (isListening) will be set by onclose.`, 'color: #ff0000');
      return;
    }

    // --- START LISTENING ---
    console.log(`%cDEBUG_LIVE_TAB: [${callId}] STARTING...`, 'color: #00cc00');
    isListeningRef.current = true;
    isSessionReadyRef.current = false;
    setIsLoading(true); // Show loading spinner
    setError(null);
    setTranscript("");
    playbackQueueRef.current = [];
    
    try {
      console.log(`%cDEBUG_LIVE_TAB: [${callId}] Fetching auth token...`, 'color: #00cc00');
      const token = await fetchAuthToken();
      if (!token) throw new Error("Received empty token");
      console.log(`%cDEBUG_LIVE_TAB: [${callId}] Got token.`, 'color: #00cc00');

      const ai = new GoogleGenAI({ 
        apiKey: token,
        httpOptions: { apiVersion: 'v1alpha' }
      });
      
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 48000
      });
      audioContextRef.current = audioCtx;
      console.log(`%cDEBUG_LIVE_TAB: [${callId}] AudioContext created, state: ${audioCtx.state}`, 'color: #00cc00');

      await audioCtx.audioWorklet.addModule('audio-processor.js');
      console.log(`%cDEBUG_LIVE_TAB: [${callId}] Audio worklet loaded.`, 'color: #00cc00');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const micNode = audioCtx.createMediaStreamSource(stream);
      micNodeRef.current = micNode;

      const workletNode = new AudioWorkletNode(audioCtx, 'audio-processor', {
        processorOptions: {
          targetSampleRate: TARGET_SAMPLE_RATE,
        }
      });
      workletNodeRef.current = workletNode;
      console.log(`%cDEBUG_LIVE_TAB: [${callId}] Mic and worklet node created.`, 'color: #00cc00');

      console.log(`%cDEBUG_LIVE_TAB: [${callId}] Calling ai.live.connect...`, 'color: #00cc00');
      const newSession = await ai.live.connect({
        model: "gemini-live-2.5-flash",
        config: {
          responseModalities: [Modality.TEXT, Modality.AUDIO],
          systemInstruction: getSystemPrompt(),
        },
        callbacks: {
          onopen: () => {
            console.log(`%cDEBUG_LIVE_TAB: [${callId}] ===> ON_OPEN fired <===`, 'color: #00cc00; font-weight: bold');
            setIsLoading(false); // Hide spinner
            setIsListening(true); // Set button to "Stop"
            isSessionReadyRef.current = true; // Flag as ready for audio
          },
          onmessage: (message) => {
            console.log(`%cDEBUG_LIVE_TAB: [${callId}] ===> ON_MESSAGE received <===`, 'color: #00cc00', message);
            if (message.text) {
              playbackQueueRef.current.push(message.data);
              playAudioQueue();
            }
          },
          onerror: (e) => {
            console.error(`%cDEBUG_LIVE_TAB: [${callId}] ===> ON_ERROR fired <===`, 'color: #ff0000; font-weight: bold', e);
            setError(`Live error: ${e.message}`);
            isSessionReadyRef.current = false; // Stop sends
          },
          onclose: () => {
            console.log(`%cDEBUG_LIVE_TAB: [${callId}] ===> ON_CLOSE fired <===`, 'color: #ff0000; font-weight: bold');
            cleanupAudioResources(); // ALWAYS clean up resources
            
            // Check if closure was unexpected
            if (isListeningRef.current) {
              console.log(`%cDEBUG_LIVE_TAB: [${callId}] onclose detected unexpected close. Resetting UI.`, 'color: #ff0000');
            } else {
              console.log(`%cDEBUG_LIVE_TAB: [${callId}] onclose was expected.`, 'color: #ffaa00');
            }
            
            // Reset all flags and state
            isListeningRef.current = false;
            isSessionReadyRef.current = false;
            sessionRef.current = null;
            setIsListening(false);
            setIsLoading(false);
            console.log(`%cDEBUG_LIVE_TAB: [${callId}] onclose has reset UI state and cleaned resources.`, 'color: #ffaa00');
          },
        },
      });
      
      console.log(`%cDEBUG_LIVE_TAB: [${callId}] ai.live.connect FINISHED. Session object created.`, 'color: #00cc00');
      sessionRef.current = newSession;

      workletNode.port.onmessage = (event) => {
        const pcmData = event.data;
        const sendTime = Date.now();
        
        if (isListeningRef.current && isSessionReadyRef.current && sessionRef.current) { 
          // console.log(`DEBUG_LIVE_TAB: [${callId}] onmessage: Trying to send audio chunk...`);
          
          // *** ADDING CATCH BLOCK BACK AS REQUESTED ***
          try { 
            sessionRef.current.sendRealtimeInput({
              audio: { data: pcmData, mimeType: `audio/pcm;rate=${TARGET_SAMPLE_RATE}` }
            });
          } catch (e) {
            console.error(`%cDEBUG_LIVE_TAB: [${callId}] sendRealtimeInput SYNC ERROR at ${sendTime}:`, 'color: #ff0000', e);
            // This error means the session is already closing.
            // Just stop trying to send. onclose will handle the full cleanup.
            isSessionReadyRef.current = false; 
          }
        } else {
          // DEBUG: Log why we skipped sending
          // if (isListeningRef.current) { // Only log if we're supposed to be listening
          //   console.log(`DEBUG_LIVE_TAB: [${callId}] onmessage: Skipped sending. isSessionReadyRef: ${isSessionReadyRef.current}, sessionRef: ${!!sessionRef.current}`);
          // }
        }
      };

      micNode.connect(workletNode);
      workletNode.connect(audioCtx.destination);
      console.log(`%cDEBUG_LIVE_TAB: [${callId}] Audio pipeline connected.`, 'color: #00cc00');
      
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("Permission denied") || msg.includes("denied")) {
        setError(t('chat.liveMicError'));
      } else if (msg.includes("token")) {
        setError(t('chat.liveTokenError'));
      } else {
        setError(`Failed to start: ${msg}`);
      }
      console.error(`%cDEBUG_LIVE_TAB: [${callId}] STARTUP FAILED (catch block):`, 'color: #ff0000', e);
      // Fallback cleanup
      isListeningRef.current = false;
      isSessionReadyRef.current = false;
      setIsListening(false);
      setIsLoading(false);
      cleanupAudioResources();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    console.log(`%cDEBUG_LIVE_TAB: useEffect (mount) fired.`, 'color: #00aaff');
    return () => {
      console.log(`%cDEBUG_LIVE_TAB: useEffect (UNMOUNT) fired. isListeningRef: ${isListeningRef.current}`, 'color: #ff0000; font-weight: bold');
      isListeningRef.current = false;
      isSessionReadyRef.current = false;
      if (sessionRef.current) {
        console.log(`%cDEBUG_LIVE_TAB: Unmount calling session.close()`, 'color: #ff0000');
        sessionRef.current.close();
      } else {
        cleanupAudioResources();
      }
    };
  }, [cleanupAudioResources]); // Stable dependency
  
  return (
    <div className="space-y-4 text-center">
      {console.log(`%cDEBUG_LIVE_TAB: Top-level RETURN (render #${renderCount.current})`, 'color: #00aaff')}
      <p className="text-sm text-gray-700">
        {isListening ? "I'm listening..." : t('chat.liveWelcome')}
      </p>
      
      {isLoading ? (
        <LoadingSpinner text={t('chat.liveLoading')} />
      ) : (
        <button
          onClick={handleStartStopChat}
          className={`font-bold py-3 px-6 rounded-lg text-white transition-all ${
            isListening 
              ? 'bg-red-600 hover:bg-red-700' 
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {isListening ? t('chat.liveStop') : t('chat.liveStart')}
        </button>
      )}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      {transcript && (
        <div className="mt-4 text-left p-3 bg-white border border-indigo-200 rounded-lg h-32 overflow-y-auto whitespace-pre-wrap">
          {transcript}
        </div>
      )}
    </div>
  );
});