import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Lesson, LanguageCode } from '../types';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from './LoadingSpinner';
import { GoogleGenAI, Modality, Content } from '@google/genai';

interface LiveChatTabProps {
  lesson: Lesson;
  uiLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  fetchAuthToken: () => Promise<string>; 
}

// Gemini API requirements
const TARGET_SAMPLE_RATE = 16000;
const INCOMING_SAMPLE_RATE = 24000;

export const LiveChatTab: React.FC<LiveChatTabProps> = ({ 
  lesson, 
  uiLanguage, 
  targetLanguage, 
  fetchAuthToken 
}) => {
  
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState<string>(""); // To show live transcript
  const [session, setSession] = useState<any | null>(null); // The live session
  const isListeningRef = useRef(false);

  // --- Audio & API Refs ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const micNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playbackQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);

  // --- 1. Get Language Names ---
  const getLanguageName = (code: LanguageCode): string => t(`languages.${code}`);

  // --- 2. System Prompt Generation ---
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

  // --- 3. Audio Playback ---
  // Plays the queue of incoming audio buffers from Gemini
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
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = audioContextRef.current;

      // The audio from Gemini is 16-bit PCM @ 24kHz.
      // We need to convert it to Float32Array for the browser to play.
      const pcmData = new Int16Array(audioBufferRaw);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768.0; // Convert from Int16 to Float32
      }

      // Create an AudioBuffer
      const audioBuffer = audioCtx.createBuffer(
        1, // 1 channel (mono)
        floatData.length, // buffer size
        INCOMING_SAMPLE_RATE // sample rate (24kHz)
      );
      audioBuffer.getChannelData(0).set(floatData);

      // Play the buffer
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
  }, []);

  // --- 4. Main Start/Stop Function ---
  const handleStartStopChat = async () => {
    if (isListening) {
      // --- STOP LISTENING ---
      console.log("DEBUG: STOP LISTENING triggered."); // <-- ADD THIS
      isListeningRef.current = false; 
      setSession(prevSession => {
        if (prevSession) {
          console.log("DEBUG: Calling session.close()"); // <-- ADD THIS
          prevSession.close();
        }
        return null; // Ensure state is cleared
      });
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }
      if (micNodeRef.current) {
        micNodeRef.current.disconnect();
        micNodeRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      setIsListening(false);
      setIsLoading(false);
      setTranscript("");
      playbackQueueRef.current = [];
      isPlayingRef.current = false;
      return;
    }

    // --- START LISTENING ---
    setIsListening(true);
    isListeningRef.current = true; // <-- ADD THIS
    setIsLoading(true);
    setError(null);
    setTranscript("");
    playbackQueueRef.current = [];
    
    try {
      // 1. Get Ephemeral Token
      const token = await fetchAuthToken();
      if (!token) throw new Error("Received empty token");

      // 2. Initialize client-side GoogleGenAI SDK
      const ai = new GoogleGenAI({ 
        apiKey: token, // Use the ephemeral token as the API key
        httpOptions: { apiVersion: 'v1alpha' } // Must use v1alpha for Live API
      });
      
      // 3. Get AudioContext and Microphone
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 48000 // Request a common high sample rate
      });
      audioContextRef.current = audioCtx;

      await audioCtx.audioWorklet.addModule('audio-processor.js');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const micNode = audioCtx.createMediaStreamSource(stream);
      micNodeRef.current = micNode;

      // 4. Create Audio Worklet for processing
      const workletNode = new AudioWorkletNode(audioCtx, 'audio-processor', {
        processorOptions: {
          targetSampleRate: TARGET_SAMPLE_RATE,
        }
      });
      workletNodeRef.current = workletNode;

      // 5. Connect to the Live API
      const newSession = await ai.live.connect({
        model: "gemini-live-2.5-flash", // Use the model specified in the docs
        config: {
          responseModalities: [Modality.TEXT, Modality.AUDIO],
          systemInstruction: getSystemPrompt(),
        },
        callbacks: {
          onopen: () => {
            console.log('DEBUG: Live session open.'); // <-- MODIFY THIS
            setIsLoading(false);
          },
          onmessage: (message) => {
            console.log("DEBUG: Received message from AI", message); // <-- ADD THIS
            // Got a message from Gemini
            if (message.text) {
              // Add raw audio buffer to queue
              playbackQueueRef.current.push(message.data);
              playAudioQueue();
            }
          },
          onerror: (e) => {
            console.error('DEBUG: Live error:', e); // <-- MODIFY THIS
            setError(`Live error: ${e.message}`);
            handleStartStopChat(); // Force stop
          },
          onclose: () => {
            console.log('DEBUG: Live session closed.'); // <-- MODIFY THIS
            // Ensure we are fully stopped
            if (isListeningRef.current) { // <-- Check the ref here
              handleStartStopChat();
            }
          },
        },
      });
      
      setSession(newSession);

      // 6. Connect the audio pipeline
      // This is where the magic happens
      workletNode.port.onmessage = (event) => {
        // We received 16-bit PCM data from the worklet
        const pcmData = event.data;
        // --- START FIX ---
        // Check our own state, not a non-existent method
        if (isListeningRef.current && newSession) { 
          // Optional: log to confirm
          console.log(`DEBUG: Sending audio chunk, size: ${pcmData.byteLength}`); // <-- UNCOMMENT THIS
          
          // Send the raw buffer to Gemini
          try { // <-- ADD TRY/CATCH
            newSession.sendRealtimeInput({ 
              audio: { data: pcmData, mimeType: `audio/pcm;rate=${TARGET_SAMPLE_RATE}` }
            }).catch(e => {
              console.error("DEBUG: ERROR during sendRealtimeInput (async):", e);
              setError(`Send error: ${(e as Error).message}`);
              handleStartStopChat(); // Stop on send error
            });
          } catch (e) {
            console.error("DEBUG: ERROR during sendRealtimeInput:", e);
            setError(`Send error: ${(e as Error).message}`);
            handleStartStopChat(); // Stop on send error
          }
        }
      };

      // Connect Mic -> Worklet
      micNode.connect(workletNode);
      // Connect Worklet -> Destination (this is often needed to keep it "alive")
      workletNode.connect(audioCtx.destination);
      
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("Permission denied") || msg.includes("denied")) {
        setError(t('chat.liveMicError'));
      } else if (msg.includes("token")) {
        setError(t('chat.liveTokenError'));
      } else {
        setError(`Failed to start: ${msg}`);
      }
      console.error("Error in handleStartStopChat:", e);
      setIsListening(false);
      setIsLoading(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isListening || session) {
        handleStartStopChat();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount/unmount

  return (
    <div className="space-y-4 text-center">
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

      {/* Live Transcript Area */}
      {transcript && (
        <div className="mt-4 text-left p-3 bg-white border border-indigo-200 rounded-lg h-32 overflow-y-auto whitespace-pre-wrap">
          {transcript}
        </div>
      )}
    </div>
  );
};