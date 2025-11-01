import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Lesson, LanguageCode } from '../types';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from './LoadingSpinner';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';

// --- CONSTANTS ---
const INCOMING_SAMPLE_RATE = 24000;
const DEBUG_COLOR_INFO = 'color: #00aaff'; // Blue
const DEBUG_COLOR_START = 'color: #00cc00'; // Green
const DEBUG_COLOR_STOP = 'color: #ff0000'; // Red
const DEBUG_COLOR_WARN = 'color: #ffaa00'; // Orange
const DEBUG_COLOR_AUDIO = 'color: #c026d3'; // Purple

// --- INTERFACE ---
interface LiveChatTabProps {
  lesson: Lesson;
  uiLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  fetchAuthToken: () => Promise<string>; 
}

// --- HELPER to get a unique call ID for logs ---
let callCounter = 0;
const getCallId = () => `call_${Date.now()}_${callCounter++}`;

export const LiveChatTab: React.FC<LiveChatTabProps> = React.memo(({ 
  lesson, 
  uiLanguage, 
  targetLanguage, 
  fetchAuthToken 
}) => {
  
  // --- STATE ---
  const [isConnectionActive, setIsConnectionActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullTranscript, setFullTranscript] = useState<string>("");
  const [interimUserTranscript, setInterimUserTranscript] = useState<string>("");

  // --- REFS ---
  const activeSession = useRef<any | null>(null);
  const playbackAudioContext = useRef<AudioContext | null>(null);
  const audioPlaybackQueue = useRef<ArrayBuffer[]>([]);
  const isAudioPlaying = useRef(false);
  
  // FIX: This ref is CRITICAL to work around React Strict Mode
  const connectionStateRef = useRef(false);
  
  // Ref to hold the component's unique ID for logging
  const componentInstanceId = useRef(`LiveChatTab_${Date.now()}`);
  const renderCount = useRef(0);
  renderCount.current += 1;

  const { t } = useTranslation();

  const LOG_PREFIX = `[${componentInstanceId.current} | Render #${renderCount.current}]`;
  console.log(`%c${LOG_PREFIX} === COMPONENT RENDER === | isConnectionActive (state): ${isConnectionActive}`, DEBUG_COLOR_INFO);

  // --- SYSTEM PROMPT ---
  // This MUST be identical to the one in `getEphemeralToken`
  const getSystemPrompt = useCallback(() => {
    console.log(`%c${LOG_PREFIX} getSystemPrompt() called.`, DEBUG_COLOR_INFO);
    const uiLangName = t(`languages.${uiLanguage}`);
    const targetLangName = t(`languages.${targetLanguage}`);
    const vocabList = lesson.vocabularyList.map((v: any) => 
      `- ${v.word} (${targetLangName}): ${v.definition} (${uiLangName}). Example: "${v.articleExample}"`
    ).join('\n');
    const comprehensionQuestions = lesson.comprehensionQuestions.join('\n- ');

    const prompt = `
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
5.  You MUST respond with both TEXT and AUDIO.`;

    console.log(`%c${LOG_PREFIX} getSystemPrompt() generated.`, DEBUG_COLOR_INFO);
    return prompt;
  }, [lesson, uiLanguage, targetLanguage, t, LOG_PREFIX]);


  // --- AUDIO CLEANUP ---
  const cleanupPlaybackResources = useCallback(() => {
    const _CALL_ID = getCallId();
    console.log(`%c${LOG_PREFIX} [${_CALL_ID}] cleanupPlaybackResources() CALLED.`, DEBUG_COLOR_STOP);
    
    // Stop any audio playback
    audioPlaybackQueue.current = [];
    isAudioPlaying.current = false;

    if (playbackAudioContext.current && playbackAudioContext.current.state !== 'closed') {
        console.log(`%c${LOG_PREFIX} [${_CALL_ID}] Closing Playback AudioContext (state: ${playbackAudioContext.current.state}).`, DEBUG_COLOR_STOP);
        playbackAudioContext.current.close().catch(e => console.warn(`${LOG_PREFIX} [${_CALL_ID}] Error closing playback audio context:`, e));
        playbackAudioContext.current = null;
    } else {
        console.log(`%c${LOG_PREFIX} [${_CALL_ID}] playbackAudioContext is already null or closed.`, DEBUG_COLOR_WARN);
    }
    
    console.log(`%c${LOG_PREFIX} [${_CALL_ID}] cleanupPlaybackResources() FINISHED.`, DEBUG_COLOR_STOP);
  }, [LOG_PREFIX]); // LOG_PREFIX is stable


  // --- AUDIO PLAYBACK ---
  const playAudioFromQueue = useCallback(async () => {
    const _CALL_ID = getCallId();
    console.log(`%c${LOG_PREFIX} [${_CALL_ID}] playAudioFromQueue() CALLED. isPlaying: ${isAudioPlaying.current}, queueLength: ${audioPlaybackQueue.current.length}`, DEBUG_COLOR_AUDIO);

    if (isAudioPlaying.current || audioPlaybackQueue.current.length === 0) {
      if (isAudioPlaying.current) console.log(`%c${LOG_PREFIX} [${_CALL_ID}] Bailing: Audio is already playing.`, DEBUG_COLOR_WARN);
      if (audioPlaybackQueue.current.length === 0) console.log(`%c${LOG_PREFIX} [${_CALL_ID}] Bailing: Queue is empty.`, DEBUG_COLOR_WARN);
      return;
    }
    
    isAudioPlaying.current = true;
    console.log(`%c${LOG_PREFIX} [${_CALL_ID}] Setting isAudioPlaying.current=true.`, DEBUG_COLOR_AUDIO);

    const audioBufferRaw = audioPlaybackQueue.current.shift();
    if (!audioBufferRaw) {
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] FAILED: Dequeued audio buffer is empty/undefined.`, DEBUG_COLOR_STOP);
      isAudioPlaying.current = false;
      return;
    }
    console.log(`%c${LOG_PREFIX} [${_CALL_ID}] Dequeued audio buffer of size ${audioBufferRaw.byteLength}.`, DEBUG_COLOR_AUDIO);


    try {
      if (!playbackAudioContext.current || playbackAudioContext.current.state === 'closed') {
        console.log(`%c${LOG_PREFIX} [${_CALL_ID}] Creating new AudioContext for playback.`, DEBUG_COLOR_WARN);
        playbackAudioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = playbackAudioContext.current;
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] Playback AudioContext state: ${audioCtx.state}.`, DEBUG_COLOR_AUDIO);

      // --- DECODE PCM ---
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] Decoding PCM data...`, DEBUG_COLOR_AUDIO);
      const pcmData = new Int16Array(audioBufferRaw);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768.0; // Convert 16-bit PCM to 32-bit float
      }
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] Decoded to ${floatData.length} float samples.`, DEBUG_COLOR_AUDIO);

      const audioBuffer = audioCtx.createBuffer(
        1, 
        floatData.length,
        INCOMING_SAMPLE_RATE 
      );
      audioBuffer.getChannelData(0).set(floatData);
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] Created AudioBuffer.`, DEBUG_COLOR_AUDIO);

      // --- PLAYBACK ---
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      source.onended = () => {
        console.log(`%c${LOG_PREFIX} [${_CALL_ID}] source.onended fired.`, DEBUG_COLOR_AUDIO);
        isAudioPlaying.current = false;
        playAudioFromQueue(); // Play next in queue
      };
      source.start();
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] source.start() called. Playback initiated.`, DEBUG_COLOR_AUDIO);

    } catch (e) {
      console.error(`%c${LOG_PREFIX} [${_CALL_ID}] FAILED: Error playing audio:`, e, DEBUG_COLOR_STOP);
      setError(`Audio playback error: ${(e as Error).message}`);
      isAudioPlaying.current = false;
    }
  }, [LOG_PREFIX, setError]);


  // --- START/STOP HANDLER ---
  const handleStartStopChat = async () => {
    const _CALL_ID = getCallId();
    // FIX: Check the REF, not the state
    console.log(`%c${LOG_PREFIX} [${_CALL_ID}] handleStartStopChat() CALLED. | Current connectionStateRef: ${connectionStateRef.current}`, DEBUG_COLOR_WARN);

    // --- STOP LISTENING ---
    if (connectionStateRef.current) {
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] STOPPING...`, DEBUG_COLOR_STOP);
      connectionStateRef.current = false; // Set ref to false *before* closing
      
      if (activeSession.current) {
        console.log(`%c${LOG_PREFIX} [${_CALL_ID}] Calling activeSession.current.close()`, DEBUG_COLOR_STOP);
        activeSession.current.close(); // This will trigger the onclose callback
      } else {
        console.log(`%c${LOG_PREFIX} [${_CALL_ID}] No session to close, cleaning up manually.`, DEBUG_COLOR_WARN);
        cleanupPlaybackResources();
        // Manually reset UI state
        setIsConnectionActive(false);
        setIsProcessing(false);
      }
      activeSession.current = null;
      
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] STOP complete. UI state will be reset by onclose handler.`, DEBUG_COLOR_STOP);
      return;
    }

    // --- START LISTENING ---
    console.log(`%c${LOG_PREFIX} [${_CALL_ID}] STARTING...`, DEBUG_COLOR_START);
    connectionStateRef.current = true; // Set ref to true immediately
    setIsProcessing(true); // Show loading spinner
    setError(null);
    setFullTranscript("");
    setInterimUserTranscript("");
    audioPlaybackQueue.current = [];
    
    try {
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] 1/8. Fetching auth token...`, DEBUG_COLOR_START);
      const token = await fetchAuthToken();
      if (!token) {
        console.error(`%c${LOG_PREFIX} [${_CALL_ID}] FAILED (1/8): Received empty token.`, DEBUG_COLOR_STOP);
        throw new Error("Received empty token");
      }
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] 2/8. Got token.`, DEBUG_COLOR_START);

      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] 3/8. Initializing GoogleGenAI client with v1alpha.`, DEBUG_COLOR_START);
      const ai = new GoogleGenAI({ 
        apiKey: token,
        httpOptions: { apiVersion: 'v1alpha' }
      });
      
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] 4/8. Creating AudioContext for playback.`, DEBUG_COLOR_START);
      // This context is only for *playback*. The library handles its own *input* context.
      playbackAudioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] 4/8. Playback AudioContext created, state: ${playbackAudioContext.current.state}`, DEBUG_COLOR_START);

      // --- DEFINE THE CONFIGURATION ---
      // This MUST identically match the config in getEphemeralToken
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] 5/8. Building connection config...`, DEBUG_COLOR_START);
      const connectionConfig = {
        responseModalities: [Modality.TEXT, Modality.AUDIO],
        speechConfig: {
          voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Orus'}},
        },
        inputAudioTranscription: {}, // Ask the library to handle the mic
        outputAudioTranscription: {}, // Ask for text of what the model says
        systemInstruction: { parts: [{ text: getSystemPrompt() }] },
      };
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] 5/8. Connection config built: ${JSON.stringify(connectionConfig, null, 2)}`, DEBUG_COLOR_START);
      
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] 6/8. Calling ai.live.connect with model 'gemini-live-2.5-flash'...`, DEBUG_COLOR_START);
      const newSession = await ai.live.connect({
        model: "gemini-live-2.5-flash",
        config: connectionConfig, // Use the identical config object
        callbacks: {
          onopen: () => {
            console.log(`%c${LOG_PREFIX} [${_CALL_ID}] ===> ON_OPEN fired <===`, DEBUG_COLOR_START);
            setIsProcessing(false); // Hide spinner
            setIsConnectionActive(true); // Set button to "Stop"
            console.log(`%c${LOG_PREFIX} [${_CALL_ID}] ON_OPEN: Set state: isProcessing=false, isConnectionActive=true.`, DEBUG_COLOR_START);
          },
          onmessage: (message: LiveServerMessage) => {
            console.log(`%c${LOG_PREFIX} [${_CALL_ID}] ===> ON_MESSAGE received <===`, DEBUG_COLOR_INFO, message);

            // Handle Text Transcriptions
            if (message.inputTranscription) {
              const { text, isFinal } = message.inputTranscription;
              console.log(`%c${LOG_PREFIX} [${_CALL_ID}] ON_MESSAGE: Received inputTranscription (isFinal: ${isFinal}): "${text}"`, DEBUG_COLOR_INFO);
              if (isFinal) {
                setFullTranscript(prev => prev + `USER: ${text}\n`);
                setInterimUserTranscript(""); // Clear interim
              } else {
                setInterimUserTranscript(`USER: ${text}`); // Show interim
              }
            }

            if (message.outputTranscription) {
               const { text, isFinal } = message.outputTranscription;
               console.log(`%c${LOG_PREFIX} [${_CALL_ID}] ON_MESSAGE: Received outputTranscription (isFinal: ${isFinal}): "${text}"`, DEBUG_COLOR_INFO);
               setFullTranscript(prev => {
                  // This logic appends the text to the *last* line of the transcript
                  if (prev.endsWith('\n') || prev.length === 0) {
                    return prev + `MAX: ${text}` + (isFinal ? '\n' : '');
                  } else {
                    const lastNewline = prev.lastIndexOf('\n');
                    const base = prev.substring(0, lastNewline + 1);
                    return base + `MAX: ${text}` + (isFinal ? '\n' : '');
                  }
               });
            }

            // Handle Audio Playback
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData;
            if (audio) {
              console.log(`%c${LOG_PREFIX} [${_CALL_ID}] ON_MESSAGE: Received audio data (${audio.data.byteLength} bytes). Pushing to playback queue.`, DEBUG_COLOR_AUDIO);
              audioPlaybackQueue.current.push(audio.data);
              playAudioFromQueue();
            } else if (message.serverContent) {
              console.log(`%c${LOG_PREFIX} [${_CALL_ID}] ON_MESSAGE: Received serverContent but no audio data.`, DEBUG_COLOR_WARN, message.serverContent);
            }
          },
          onerror: (e) => {
            console.error(`%c${LOG_PREFIX} [${_CALL_ID}] ===> ON_ERROR fired <===`, DEBUG_COLOR_STOP, e);
            setError(`Live error: ${e.message}`);
            console.log(`%c${LOG_PREFIX} [${_CALL_ID}] ON_ERROR: Set state: error.`, DEBUG_COLOR_STOP);
            // Let onclose handle the state resets
          },
          onclose: () => {
            console.log(`%c${LOG_PREFIX} [${_CALL_ID}] ===> ON_CLOSE fired <===`, DEBUG_COLOR_STOP);
            cleanupPlaybackResources(); // Clean up audio playback
            
            // FIX: Check the REF (connectionStateRef.current) not the STATE (isConnectionActive)
            if (connectionStateRef.current) {
              // This means it was an *unexpected* close
              console.log(`%c${LOG_PREFIX} [${_CALL_ID}] ON_CLOSE: Detected unexpected close (connectionStateRef.current was true). Resetting UI.`, DEBUG_COLOR_STOP);
              setError("Connection closed unexpectedly. Please try again.");
            } else {
              // This was an *expected* close (user clicked Stop or StrictMode unmount)
              console.log(`%c${LOG_PREFIX} [${_CALL_ID}] ON_CLOSE: This was an expected closure (connectionStateRef.current was false).`, DEBUG_COLOR_INFO);
            }
            
            // Reset all flags and state
            connectionStateRef.current = false; // Ensure ref is reset
            activeSession.current = null;
            setIsConnectionActive(false);
            setIsProcessing(false);
            setInterimUserTranscript(""); // Clear interim text
            console.log(`%c${LOG_PREFIX} [${_CALL_ID}] ON_CLOSE: All state and refs reset.`, DEBUG_COLOR_STOP);
          },
        },
      });
      
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] 7/8. ai.live.connect call FINISHED. Session object created.`, DEBUG_COLOR_START);
      activeSession.current = newSession;

      // The library is now handling the microphone. We are done here.
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] 8/8. STARTUP COMPLETE. Library is handling microphone.`, DEBUG_COLOR_START);
      
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`%c${LOG_PREFIX} [${_CALL_ID}] FAILED: STARTUP FAILED (catch block):`, DEBUG_COLOR_STOP, e);
      if (msg.includes("Permission denied") || msg.includes("denied")) {
        setError(t('chat.liveMicError'));
      } else if (msg.includes("token")) {
        setError(t('chat.liveTokenError'));
      } else {
        setError(`Failed to start: ${msg}`);
      }
      
      // Fallback cleanup
      console.log(`%c${LOG_PREFIX} [${_CALL_ID}] STARTUP FAILED: Running fallback cleanup...`, DEBUG_COLOR_STOP);
      connectionStateRef.current = false;
      setIsConnectionActive(false);
      setIsProcessing(false);
      cleanupPlaybackResources();
    }
  };

  // --- UNMOUNT CLEANUP ---
  useEffect(() => {
    console.log(`%c${LOG_PREFIX} useEffect (mount) fired.`, DEBUG_COLOR_INFO);
    return () => {
      // FIX: Check the ref here, which I failed to do before
      console.log(`%c${LOG_PREFIX} useEffect (UNMOUNT) fired. connectionStateRef.current: ${connectionStateRef.current}`, DEBUG_COLOR_STOP);
      
      // FIX: Set ref to false FIRST. This tells the onclose handler
      // that this closure is intentional (an unmount or "stop").
      connectionStateRef.current = false; 

      if (activeSession.current) {
        console.log(`%c${LOG_PREFIX} Unmount: Calling activeSession.current.close()`, DEBUG_COLOR_STOP);
        activeSession.current.close();
        activeSession.current = null;
      } else {
        console.log(`%c${LOG_PREFIX} Unmount: No session, just cleaning up resources.`, DEBUG_COLOR_WARN);
        cleanupPlaybackResources();
      }
    };
  }, [cleanupPlaybackResources, LOG_PREFIX]); // Dependencies are stable
  
  // --- RENDER ---
  return (
    <div className="space-y-4 text-center">
      {console.log(`%c${LOG_PREFIX} Top-level RETURN rendering.`, DEBUG_COLOR_INFO)}
      <p className="text-sm text-gray-700">
        {isConnectionActive ? "I'm listening..." : t('chat.liveWelcome')}
      </p>
      
      {isProcessing ? (
        <LoadingSpinner text={t('chat.liveLoading')} />
      ) : (
        <button
          onClick={handleStartStopChat}
          className={`font-bold py-3 px-6 rounded-lg text-white transition-all ${
            isConnectionActive 
              ? 'bg-red-600 hover:bg-red-700' 
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {isConnectionActive ? t('chat.liveStop') : t('chat.liveStart')}
        </button>
      )}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      {/* Transcript Area */}
      {isConnectionActive || fullTranscript || interimUserTranscript ? ( // Show if listening OR if there is a transcript
        <div 
          className="mt-4 text-left p-3 bg-white border border-indigo-200 rounded-lg h-32 overflow-y-auto whitespace-pre-wrap"
          ref={el => {
            // Auto-scroll to bottom
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          {fullTranscript}
          {interimUserTranscript && (
            <span className="text-gray-400">{interimUserTranscript}</span>
          )}
          {(!fullTranscript && !interimUserTranscript && isConnectionActive) && (
             <span className="text-gray-400">Listening...</span>
          )}
        </div>
      ) : null}
    </div>
  );
});