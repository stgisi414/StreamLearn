// stgisi414/streamlearn/StreamLearn-9282341a63ce7e0d409702bc90f81e24e5098e1e/components/LiveChatTab.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Lesson, LanguageCode } from '../types';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from './LoadingSpinner';
import { GenAILiveClient } from '@/lib/genai-live-client';
import { AudioRecorder } from '@/lib/audio-recorder';
import { AudioStreamer } from '@/lib/audio-streamer';
import { base64AudioToBlob, audioContext } from '@/lib/utils';
import { LiveConnectConfig, Modality } from '@google/genai';

// --- LOGGING ---
const LOG_PREFIX = '[DEBUG_LIVE_TAB]';
console.log(`${LOG_PREFIX} File loaded.`);
// --- END LOGGING ---

interface LiveChatTabProps {
  lesson: Lesson;
  uiLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  fetchAuthToken: () => Promise<string>;
}

// --- HELPER FUNCTION ---
const getSimpleLanguageName = (code: LanguageCode | string): string => {
// ... (this function is unchanged) ...
  console.log(`${LOG_PREFIX} getSimpleLanguageName called with code: ${code}`);
  switch (code) {
    case "en": console.log(`${LOG_PREFIX} getSimpleLanguageName: returning "English"`); return "English";
    case "es": console.log(`${LOG_PREFIX} getSimpleLanguageName: returning "Spanish"`); return "Spanish";
    case "fr": console.log(`${LOG_PREFIX} getSimpleLanguageName: returning "French"`); return "French";
    case "de": console.log(`${LOG_PREFIX} getSimpleLanguageName: returning "German"`); return "German";
    case "it": console.log(`${LOG_PREFIX} getSimpleLanguageName: returning "Italian"`); return "Italian";
    case "ko": console.log(`${LOG_PREFIX} getSimpleLanguageName: returning "Korean"`); return "Korean";
    case "ja": console.log(`${LOG_PREFIX} getSimpleLanguageName: returning "Japanese"`); return "Japanese";
    case "zh": console.log(`${LOG_PREFIX} getSimpleLanguageName: returning "Chinese"`); return "Chinese";
    default: console.log(`${LOG_PREFIX} getSimpleLanguageName: returning "English" (default)`); return "English"; // Fallback
  }
};
// --- END HELPER FUNCTION ---

export const LiveChatTab: React.FC<LiveChatTabProps> = React.memo(({
  lesson,
  uiLanguage,
  targetLanguage,
  fetchAuthToken
}) => {
// ... (states and refs are unchanged) ...
  console.log(`${LOG_PREFIX} LiveChatTab component rendering...`);
  console.log(`${LOG_PREFIX} Props:`, { lesson: !!lesson, uiLanguage, targetLanguage, fetchAuthToken: !!fetchAuthToken });

  const { t } = useTranslation();
  console.log(`${LOG_PREFIX} t function initialized.`);

  // --- State ---
  const [isSessionActive, setIsSessionActive] = useState(false);
  console.log(`${LOG_PREFIX} State [isSessionActive]:`, isSessionActive);
  const [isConnecting, setIsConnecting] = useState(false);
  console.log(`${LOG_PREFIX} State [isConnecting]:`, isConnecting);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  console.log(`${LOG_PREFIX} State [errorMessage]:`, errorMessage);
  
  const [conversationLog, setConversationLog] = useState<string>("");
  console.log(`${LOG_PREFIX} State [conversationLog] length:`, conversationLog.length);
  const [interimLog, setInterimLog] = useState<string>("");
  console.log(`${LOG_PREFIX} State [interimLog] length:`, interimLog.length);
  // --- End State ---

  // --- Refs ---
  const clientRef = useRef<GenAILiveClient | null>(null);
  console.log(`${LOG_PREFIX} Ref [clientRef.current]:`, clientRef.current ? 'Exists' : 'null');
  const recorderRef = useRef<AudioRecorder | null>(null);
  console.log(`${LOG_PREFIX} Ref [recorderRef.current]:`, recorderRef.current ? 'Exists' : 'null');
  const streamerRef = useRef<AudioStreamer | null>(null);
  console.log(`${LOG_PREFIX} Ref [streamerRef.current]:`, streamerRef.current ? 'Exists' : 'null');
  const connectionStateRef = useRef(false);
  console.log(`${LOG_PREFIX} Ref [connectionStateRef.current]:`, connectionStateRef.current);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  console.log(`${LOG_PREFIX} Ref [transcriptEndRef.current]:`, transcriptEndRef.current ? 'Exists' : 'null');
  // --- End Refs ---

  // Auto-scroll for transcript
  useEffect(() => {
    console.log(`${LOG_PREFIX} useEffect [scroll] triggered.`);
    if (transcriptEndRef.current) {
      console.log(`${LOG_PREFIX} useEffect [scroll]: Scrolling to bottom.`);
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      console.log(`${LOG_PREFIX} useEffect [scroll]: transcriptEndRef.current is null.`);
    }
  }, [conversationLog, interimLog]);

  // --- System Prompt Builder ---
  const getSystemPrompt = useCallback(() => {
// ... (this function is unchanged) ...
    console.log(`${LOG_PREFIX} getSystemPrompt (useCallback) called.`);
    console.log(`${LOG_PREFIX} getSystemPrompt: Using uiLanguage: ${uiLanguage}, targetLanguage: ${targetLanguage}`);
    const uiLangName = getSimpleLanguageName(uiLanguage);
    const targetLangName = getSimpleLanguageName(targetLanguage);
    console.log(`${LOG_PREFIX} getSystemPrompt: Resolved names: uiLangName=${uiLangName}, targetLangName=${targetLangName}`);

    console.log(`${LOG_PREFIX} getSystemPrompt: Mapping vocab...`);
    const vocabList = lesson.vocabularyList.map((v: any) =>
      `- ${v.word} (${targetLangName}): ${v.definition} (${uiLangName}). Example: "${v.articleExample}"`
    ).join('\n');
    console.log(`${LOG_PREFIX} getSystemPrompt: Mapping comprehension questions...`);
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
5.  You MUST respond with both TEXT AND AUDIO.`;
    console.log(`${LOG_PREFIX} getSystemPrompt: Prompt created.`);
    return prompt;
  }, [lesson, uiLanguage, targetLanguage]);

  // --- Connection Config Builder ---
  const getConnectionConfig = useCallback((): LiveConnectConfig => {
// ... (this function is unchanged) ...
    console.log(`${LOG_PREFIX} getConnectionConfig (useCallback) called.`);
    const systemPrompt = getSystemPrompt();
    console.log(`${LOG_PREFIX} getConnectionConfig: Got system prompt.`);
    const config: any = {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Orus' } },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction: { parts: [{ text: getSystemPrompt() }] },
      tools: [],
      thinkingConfig: {
        thinkingBudget: 0
      },
    };
    console.log(`${LOG_PREFIX} getConnectionConfig: Config object created:`, config);
    return config as LiveConnectConfig;
  }, [getSystemPrompt]);


  // --- Main Cleanup Function ---
  const cleanupConnection = useCallback(() => {
// ... (this function is unchanged) ...
    console.log(`${LOG_PREFIX} cleanupConnection (useCallback) called. connectionStateRef.current: ${connectionStateRef.current}`);
    connectionStateRef.current = false;
    console.log(`${LOG_PREFIX} cleanupConnection: Set connectionStateRef.current = false.`);

    if (clientRef.current) {
      console.log(`${LOG_PREFIX} cleanupConnection: Disconnecting client...`);
      clientRef.current.disconnect();
      clientRef.current = null;
      console.log(`${LOG_PREFIX} cleanupConnection: clientRef.current set to null.`);
    } else {
      console.log(`${LOG_PREFIX} cleanupConnection: No clientRef.current to disconnect.`);
    }
    
    if (recorderRef.current) {
      console.log(`${LOG_PREFIX} cleanupConnection: Stopping recorder...`);
      recorderRef.current.stop();
      recorderRef.current = null;
      console.log(`${LOG_PREFIX} cleanupConnection: recorderRef.current set to null.`);
    } else {
      console.log(`${LOG_PREFIX} cleanupConnection: No recorderRef.current to stop.`);
    }
    
    if (streamerRef.current) {
      console.log(`${LOG_PREFIX} cleanupConnection: Stopping streamer...`);
      streamerRef.current.stop();
      streamerRef.current = null;
      console.log(`${LOG_PREFIX} cleanupConnection: streamerRef.current set to null.`);
    } else {
      console.log(`${LOG_PREFIX} cleanupConnection: No streamerRef.current to stop.`);
    }
    
    console.log(`${LOG_PREFIX} cleanupConnection: Setting states...`);
    setIsSessionActive(false);
    setIsConnecting(false);
    setInterimLog("");
    console.log(`${LOG_PREFIX} cleanupConnection: States set.`);
  }, []); // No dependencies, it's a static utility

  // --- Start/Stop Handler ---
  const handleToggleConnection = async () => {
    console.log(`${LOG_PREFIX} handleToggleConnection called. connectionStateRef.current: ${connectionStateRef.current}`);

    // --- STOPPING ---
    if (connectionStateRef.current) {
      console.log(`${LOG_PREFIX} handleToggleConnection: STOPPING connection.`);
      cleanupConnection();
      console.log(`${LOG_PREFIX} handleToggleConnection: STOP complete.`);
      return;
    }

    // --- STARTING ---
    console.log(`${LOG_PREFIX} handleToggleConnection: STARTING connection.`);
    console.log(`${LOG_PREFIX} handleToggleConnection: Setting initial states...`);
    setIsConnecting(true);
    setErrorMessage(null);
    setConversationLog("");
    setInterimLog("");
    connectionStateRef.current = true; // Set lock
    console.log(`${LOG_PREFIX} handleToggleConnection: Initial states set. connectionStateRef.current = true.`);

    try {
      // 1. Get auth token
// ... (this section is unchanged) ...
      console.log(`${LOG_PREFIX} handleToggleConnection: 1. Fetching auth token...`);
      const token = await fetchAuthToken();
      if (!token) {
        console.error(`${LOG_PREFIX} handleToggleConnection: Token is null or empty.`);
        throw new Error("Received empty token");
      }
      console.log(`${LOG_PREFIX} handleToggleConnection: 1. Auth token received (length: ${token.length}).`);
      
      if (!connectionStateRef.current) {
        console.warn(`${LOG_PREFIX} handleToggleConnection: Connection cancelled during auth token fetch. Aborting start.`);
        return; // Check if user cancelled during fetch
      }

      // 2. Init classes
      console.log(`${LOG_PREFIX} handleToggleConnection: 2. Initializing client and peripherals...`);
      const client = new GenAILiveClient(token);
      clientRef.current = client;
      console.log(`${LOG_PREFIX} handleToggleConnection: 2. GenAILiveClient created.`);

      const recorder = new AudioRecorder();
      recorderRef.current = recorder;
      console.log(`${LOG_PREFIX} handleToggleConnection: 2. AudioRecorder created.`);

      // *** THE FIX: Match the recorder's sample rate ***
      console.log(`${LOG_PREFIX} handleToggleConnection: 2. Creating AudioContext for streamer (16000Hz)...`);
      const audioCtx = await audioContext({ sampleRate: 16000 }); 
      // *** END FIX ***
      console.log(`${LOG_PREFIX} handleToggleConnection: 2. AudioContext state: ${audioCtx.state}.`);
      if (audioCtx.state === 'suspended') {
        console.log(`${LOG_PREFIX} handleToggleConnection: 2. Resuming AudioContext...`);
        await audioCtx.resume();
        console.log(`${LOG_PREFIX} handleToggleConnection: 2. AudioContext resumed. New state: ${audioCtx.state}.`);
      }
      const streamer = new AudioStreamer(audioCtx);
      streamerRef.current = streamer;
      console.log(`${LOG_PREFIX} handleToggleConnection: 2. AudioStreamer created.`);

      // 3. Setup Client Event Handlers
// ... (this section is unchanged) ...
      console.log(`${LOG_PREFIX} handleToggleConnection: 3. Setting up client event handlers...`);
      client.on('open', () => {
        console.log(`${LOG_PREFIX} client.on('open'): FIRED.`);
        if (!connectionStateRef.current) {
          console.log(`${LOG_PREFIX} client.on('open'): Connection already cancelled. Ignoring.`);
          return;
        }
        console.log(`${LOG_PREFIX} client.on('open'): Setting state: isConnecting=false, isSessionActive=true.`);
        setIsConnecting(false);
        setIsSessionActive(true);
      });

      client.on('close', (e) => {
        console.log(`${LOG_PREFIX} client.on('close'): FIRED. Reason: ${e.reason} Code: ${e.code}`);
        if (connectionStateRef.current) {
          console.error(`${LOG_PREFIX} client.on('close'): Connection closed unexpectedly.`);
          setErrorMessage("Connection closed unexpectedly. " + e.reason);
        } else {
          console.log(`${LOG_PREFIX} client.on('close'): Connection closed expectedly.`);
        }
        cleanupConnection();
      });

      client.on('error', (e) => {
        console.error(`${LOG_PREFIX} client.on('error'): FIRED.`, e);
        setErrorMessage(e.message || "An unknown connection error occurred.");
        cleanupConnection();
      });

      client.on('inputTranscription', (text, isFinal) => {
        console.log(`${LOG_PREFIX} client.on('inputTranscription'): FIRED. isFinal: ${isFinal}, text: ${text}`);
        if (isFinal) {
          console.log(`${LOG_PREFIX} client.on('inputTranscription'): Final. Updating conversationLog, clearing interimLog.`);
          setConversationLog(prev => prev + `USER: ${text}\n`);
          setInterimLog("");
        } else {
          console.log(`${LOG_PREFIX} client.on('inputTranscription'): Interim. Updating interimLog.`);
          setInterimLog(`USER: ${text}`);
        }
      });

      client.on('outputTranscription', (text, isFinal) => {
        console.log(`${LOG_PREFIX} client.on('outputTranscription'): FIRED. isFinal: ${isFinal}, text: ${text}`);
        setConversationLog(prev => { 
          let newLog;
          if (prev.endsWith('\n') || prev.length === 0) {
            newLog = prev + `MAX: ${text}` + (isFinal ? '\n' : '');
            console.log(`${LOG_PREFIX} client.on('outputTranscription'): Appending new 'MAX:' line.`);
          } else {
            const lastNewline = prev.lastIndexOf('\n');
            const base = prev.substring(0, lastNewline + 1);
            newLog = base + `MAX: ${text}` + (isFinal ? '\n' : '');
            console.log(`${LOG_PREFIX} client.on('outputTranscription'): Replacing existing 'MAX:' line.`);
          }
          return newLog;
        });
      });

      client.on('audio', (audioData) => {
        console.log(`${LOG_PREFIX} client.on('audio'): FIRED. Received ${audioData.byteLength} bytes.`);
        if (streamerRef.current) {
          console.log(`${LOG_PREFIX} client.on('audio'): Sending data to streamer.`);
          streamerRef.current.addPCM16(new Uint8Array(audioData));
        } else {
          console.warn(`${LOG_PREFIX} client.on('audio'): streamerRef.current is null, cannot play audio.`);
        }
      });
      console.log(`${LOG_PREFIX} handleToggleConnection: 3. Client event handlers set.`);

      // 4. Setup Recorder Event Handler
// ... (this section is unchanged) ...
      console.log(`${LOG_PREFIX} handleToggleConnection: 4. Setting up recorder event handler...`);
      recorder.on('data', (base64Audio) => {
        console.log(`${LOG_PREFIX} recorder.on('data'): FIRED. Received audio data (base64 length: ${base64Audio.length}).`);
        if (clientRef.current && clientRef.current.status === 'connected') {
          console.log(`${LOG_PREFIX} recorder.on('data'): Client connected, converting base64 to blob...`);
          const audioBlob = base64AudioToBlob(base64Audio as string);
          console.log(`${LOG_PREFIX} recorder.on('data'): Sending blob to client.`);
          clientRef.current.sendRealtimeInput([audioBlob]);
        } else {
          console.warn(`${LOG_PREFIX} recorder.on('data'): Client not connected or ref is null. Dropping audio packet.`);
        }
      });
      console.log(`${LOG_PREFIX} handleToggleConnection: 4. Recorder event handler set.`);

      // 5. Connect Client
// ... (this section is unchanged) ...
      console.log(`${LOG_PREFIX} handleToggleConnection: 5. Getting connection config...`);
      const config = getConnectionConfig();
      console.log(`${LOG_PREFIX} handleToggleConnection: 5. Calling client.connect()...`);
      await client.connect(config);
      console.log(`${LOG_PREFIX} handleToggleConnection: 5. client.connect() promise resolved.`);
      
      if (!connectionStateRef.current) {
        console.warn(`${LOG_PREFIX} handleToggleConnection: Connection cancelled during client.connect(). Cleaning up.`);
        cleanupConnection();
        return;
      }

      // 6. Start Recorder
// ... (this section is unchanged) ...
      console.log(`${LOG_PREFIX} handleToggleConnection: 6. Calling recorder.start()...`);
      await recorder.start();
      console.log(`${LOG_PREFIX} handleToggleConnection: 6. recorder.start() promise resolved. Live session is fully active.`);

    } catch (e) {
      const msg = (e as Error).message;
      console.error(`${LOG_PREFIX} handleToggleConnection: STARTUP FAILED (catch block):`, e);
      if (msg.includes("Permission denied") || msg.includes("denied")) {
        console.error(`${LOG_PREFIX} Mic permission denied.`);
        setErrorMessage(t('chat.liveMicError'));
      } else if (msg.includes("token")) {
        console.error(`${LOG_PREFIX} Token error.`);
        setErrorMessage(t('chat.liveTokenError'));
      } else {
        console.error(`${LOG_PREFIX} Unknown startup error.`);
        setErrorMessage(`Failed to start: ${msg}`);
      }
      cleanupConnection();
    }
  };

  // --- Unmount Cleanup ---
  useEffect(() => {
// ... (this function is unchanged) ...
    console.log(`${LOG_PREFIX} useEffect [unmount] setup.`);
    // Return a cleanup function
    return () => {
      console.log(`${LOG_PREFIX} useEffect [unmount]: Component unmounting, running cleanup...`);
      cleanupConnection();
    };
  }, [cleanupConnection]); // Dependency array includes the stable cleanup function

  // --- RENDER ---
  console.log(`${LOG_PREFIX} render() called.`);
  return (
// ... (this section is unchanged) ...
    <div className="space-y-4 text-center">
      {console.log(`${LOG_PREFIX} render: Rendering <p>`)}
      <p className="text-sm text-gray-700">
        {isSessionActive ? "I'm listening..." : t('chat.liveWelcome')}
      </p>

      {isConnecting ? (
        <>
          {console.log(`${LOG_PREFIX} render: Rendering <LoadingSpinner>`)}
          <LoadingSpinner text={t('chat.liveLoading')} />
        </>
      ) : (
        <>
          {console.log(`${LOG_PREFIX} render: Rendering <button>`)}
          <button
            onClick={handleToggleConnection}
            className={`font-bold py-3 px-6 rounded-lg text-white transition-all ${
              isSessionActive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {isSessionActive ? t('chat.liveStop') : t('chat.liveStart')}
          </button>
        </>
      )}
      {errorMessage && (
        <>
          {console.log(`${LOG_PREFIX} render: Rendering error message:`, errorMessage)}
          <p className="text-sm text-red-600 mt-2">{errorMessage}</p>
        </>
      )}

      {/* Transcript Area */}
      {(isSessionActive || isConnecting || conversationLog || interimLog) ? (
        <>
          {console.log(`${LOG_PREFIX} render: Rendering transcript area.`)}
          <div
            className="mt-4 text-left p-3 bg-white border border-indigo-200 rounded-lg h-32 overflow-y-auto whitespace-pre-wrap"
          >
            {console.log(`${LOG_PREFIX} render: Rendering conversationLog...`)}
            {conversationLog}
            {interimLog && (
              <>
                {console.log(`${LOG_PREFIX} render: Rendering interimLog...`)}
                <span className="text-gray-400">{interimLog}</span>
              </>
            )}
            {(!conversationLog && !interimLog && isSessionActive) && (
              <>
                {console.log(`${LOG_PREFIX} render: Rendering 'Listening...' placeholder.`)}
                <span className="text-gray-400">Listening...</span>
              </>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </>
      ) : (
        <>
          {console.log(`${LOG_PREFIX} render: Not rendering transcript area.`)}
          {null}
        </>
      )}
    </div>
  );
});