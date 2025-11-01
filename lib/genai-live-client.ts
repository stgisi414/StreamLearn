// stgisi414/streamlearn/StreamLearn-9282341a63ce7e0d409702bc90f81e24e5098e1e/lib/genai-live-client.ts
import {
  GoogleGenAI,
  LiveCallbacks,
  LiveClientToolResponse,
  LiveConnectConfig,
  LiveServerContent,
  LiveServerMessage,
  LiveServerToolCall,
  LiveServerToolCallCancellation,
  Part,
  Session,
  Blob,
} from '@google/genai';
import EventEmitter from 'eventemitter3';
// --- FIX: REMOVED LODASH DEPENDENCY ---
// import { difference } from 'lodash';
// --- END FIX ---
import { base64ToArrayBuffer } from './utils';

// --- LOGGING ---
const LOG_PREFIX = '[DEBUG_LIVE_CLIENT]';
console.log(`${LOG_PREFIX} File loaded.`);
// --- END LOGGING ---

export interface StreamingLog {
  count?: number;
  data?: unknown;
  date: Date;
  message: string | object;
  type: string;
}

export interface LiveClientEventTypes {
  audio: (data: ArrayBuffer) => void;
  close: (event: CloseEvent) => void;
  content: (data: LiveServerContent) => void;
  error: (e: ErrorEvent) => void;
  interrupted: () => void;
  log: (log: StreamingLog) => void;
  open: () => void;
  setupcomplete: () => void;
  toolcall: (toolCall: LiveServerToolCall) => void;
  toolcallcancellation: (
    toolcallCancellation: LiveServerToolCallCancellation
  ) => void;
  turncomplete: () => void;
  generationcomplete: () => void;
  inputTranscription: (text: string, isFinal: boolean) => void;
  outputTranscription: (text: string, isFinal: boolean) => void;
}

export class GenAILiveClient {
  public readonly model: string = "gemini-live-2.5-flash";
  private emitter = new EventEmitter<LiveClientEventTypes>();
  public on = this.emitter.on.bind(this.emitter);
  public off = this.emitter.off.bind(this.emitter);

  protected readonly client: GoogleGenAI;
  protected session?: Session;

  private _status: 'connected' | 'disconnected' | 'connecting' = 'disconnected';
  public get status() {
    console.log(`${LOG_PREFIX} get status(): returning ${this._status}`);
    return this._status;
  }

  constructor(apiKey: string, model?: string) {
    console.log(`${LOG_PREFIX} constructor() called.`);
    if (model) {
      this.model = model;
      console.log(`${LOG_PREFIX} constructor: Model overridden to: ${model}`);
    } else {
      console.log(`${LOG_PREFIX} constructor: Using default model: ${this.model}`);
    }

    this.client = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: { apiVersion: 'v1alpha' }
    });
    console.log(`${LOG_PREFIX} constructor: GoogleGenAI client created.`);
  }

  public async connect(config: LiveConnectConfig): Promise<boolean> {
    console.log(`${LOG_PREFIX} connect() called. Current status: ${this._status}`);
    console.log(`${LOG_PREFIX} connect: Config received:`, JSON.stringify(config));

    if (this._status === 'connected' || this._status === 'connecting') {
      console.warn(`${LOG_PREFIX} connect: Already connected or connecting. Aborting.`);
      return false;
    }

    this._status = 'connecting';
    console.log(`${LOG_PREFIX} connect: Set status to 'connecting'.`);
    
    const callbacks: LiveCallbacks = {
      onopen: this.onOpen.bind(this),
      onmessage: this.onMessage.bind(this),
      onerror: this.onError.bind(this),
      onclose: this.onClose.bind(this),
    };
    console.log(`${LOG_PREFIX} connect: Callbacks object created.`);

    try {
      console.log(`${LOG_PREFIX} connect: Calling this.client.live.connect...`);
      this.session = await this.client.live.connect({
        model: this.model,
        config: {
          ...config,
        },
        callbacks,
      });
      console.log(`${LOG_PREFIX} connect: this.client.live.connect() promise resolved.`);
    } catch (e: any) {
      console.error(`${LOG_PREFIX} connect: Error during connection:`, e);
      this._status = 'disconnected';
      console.log(`${LOG_PREFIX} connect: Set status to 'disconnected' due to error.`);
      this.session = undefined;
      const errorEvent = new ErrorEvent('error', {
        error: e,
        message: e?.message || 'Failed to connect.',
      });
      this.onError(errorEvent);
      return false;
    }

    this._status = 'connected';
    console.log(`${LOG_PREFIX} connect: Set status to 'connected'.`);
    return true;
  }

  public disconnect() {
    console.log(`${LOG_PREFIX} disconnect() called.`);
    if (this.session) {
      console.log(`${LOG_PREFIX} disconnect: Calling this.session.close().`);
      this.session?.close();
      this.session = undefined;
    } else {
      console.log(`${LOG_PREFIX} disconnect: No session to close.`);
    }
    this._status = 'disconnected';
    console.log(`${LOG_PREFIX} disconnect: Set status to 'disconnected'.`);

    this.log('client.close', `Disconnected`);
    return true;
  }

  public send(parts: Part | Part[], turnComplete: boolean = true) {
    console.log(`${LOG_PREFIX} send() called.`);
    if (this._status !== 'connected' || !this.session) {
      console.error(`${LOG_PREFIX} send: Client not connected. Emitting error.`);
      this.emitter.emit('error', new ErrorEvent('Client is not connected'));
      return;
    }
    console.log(`${LOG_PREFIX} send: Calling this.session.sendClientContent...`);
    this.session.sendClientContent({ turns: parts, turnComplete });
    this.log(`client.send`, parts);
  }

  public sendRealtimeText(text: string) {
    console.log(`${LOG_PREFIX} sendRealtimeText() called with text: ${text}`);
    if (this._status !== 'connected' || !this.session) {
      console.error(`${LOG_PREFIX} sendRealtimeText: Client not connected. Emitting error.`);
      this.emitter.emit('error', new ErrorEvent('Client is not connected'));
      console.error(`sendRealtimeText: Client is not connected, for message: ${text}`)
      return;
    }
    console.log(`${LOG_PREFIX} sendRealtimeText: Calling this.session.sendRealtimeInput...`);
    this.session.sendRealtimeInput({ text });
    this.log(`client.send`, text);
  }

  public sendRealtimeInput(chunks: Array<Blob>) {
    console.log(`${LOG_PREFIX} sendRealtimeInput() called with ${chunks.length} chunks.`);
    if (this._status !== 'connected' || !this.session) {
      console.error(`${LOG_PREFIX} sendRealtimeInput: Client not connected. Emitting error.`);
      this.emitter.emit('error', new ErrorEvent('Client is not connected'));
      return;
    }
    
    console.log(`${LOG_PREFIX} sendRealtimeInput: Looping over chunks...`);
    chunks.forEach((chunk, index) => {
      console.log(`${LOG_PREFIX} sendRealtimeInput: Sending chunk ${index+1} of ${chunks.length} (type: ${chunk.type}, size: ${chunk.size})`);
      this.session!.sendRealtimeInput({ media: chunk });
    });

    let hasAudio = false;
    let hasVideo = false;
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      if (ch.type?.includes('audio')) hasAudio = true;
      if (ch.type?.includes('image')) hasVideo = true;
      if (hasAudio && hasVideo) break;
    }
    let message = 'unknown';
    if (hasAudio && hasVideo) message = 'audio + video';
    else if (hasAudio) message = 'audio';
    else if (hasVideo) message = 'video';
    this.log(`client.realtimeInput`, message);
  }

  public sendToolResponse(toolResponse: LiveClientToolResponse) {
    console.log(`${LOG_PREFIX} sendToolResponse() called with:`, toolResponse);
    if (this._status !== 'connected' || !this.session) {
      console.error(`${LOG_PREFIX} sendToolResponse: Client not connected. Emitting error.`);
      this.emitter.emit('error', new ErrorEvent('Client is not connected'));
      return;
    }
    if (
      toolResponse.functionResponses &&
      toolResponse.functionResponses.length
    ) {
      console.log(`${LOG_PREFIX} sendToolResponse: Sending function responses...`);
      this.session.sendToolResponse({
        functionResponses: toolResponse.functionResponses!,
      });
    } else {
      console.log(`${LOG_PREFIX} sendToolResponse: No function responses to send.`);
    }

    this.log(`client.toolResponse`, { toolResponse });
  }

  protected onMessage(message: LiveServerMessage) {
    console.log(`${LOG_PREFIX} onMessage() received:`, message);

    if (message.setupComplete) {
      console.log(`${LOG_PREFIX} onMessage: setupComplete. Emitting 'setupcomplete'.`);
      this.emitter.emit('setupcomplete');
      return;
    }
    if (message.toolCall) {
      console.log(`${LOG_PREFIX} onMessage: toolCall. Emitting 'toolcall'.`);
      this.log('server.toolCall', message);
      this.emitter.emit('toolcall', message.toolCall);
      return;
    }
    if (message.toolCallCancellation) {
      console.log(`${LOG_PREFIX} onMessage: toolCallCancellation. Emitting 'toolcallcancellation'.`);
      this.log('receive.toolCallCancellation', message);
      this.emitter.emit('toolcallcancellation', message.toolCallCancellation);
      return;
    }

    if (message.serverContent) {
      console.log(`${LOG_PREFIX} onMessage: Processing serverContent...`);
      const { serverContent } = message;
      if (serverContent.interrupted) {
        console.log(`${LOG_PREFIX} onMessage: serverContent.interrupted. Emitting 'interrupted'.`);
        this.log('receive.serverContent', 'interrupted');
        this.emitter.emit('interrupted');
        return;
      }

      if (serverContent.inputTranscription) {
        const isFinal = (serverContent.inputTranscription as any).isFinal ?? false;
        console.log(`${LOG_PREFIX} onMessage: inputTranscription. Emitting 'inputTranscription' (isFinal: ${isFinal}).`);
        this.emitter.emit(
          'inputTranscription',
          serverContent.inputTranscription.text,
          isFinal,
        );
        this.log(
          'server.inputTranscription',
          serverContent.inputTranscription.text,
        );
      }

      if (serverContent.outputTranscription) {
        const isFinal = (serverContent.outputTranscription as any).isFinal ?? false;
        console.log(`${LOG_PREFIX} onMessage: outputTranscription. Emitting 'outputTranscription' (isFinal: ${isFinal}).`);
        this.emitter.emit(
          'outputTranscription',
          serverContent.outputTranscription.text,
          isFinal,
        );
        this.log(
          'server.outputTranscription',
          serverContent.outputTranscription.text,
        );
      }

      if (serverContent.modelTurn) {
        console.log(`${LOG_PREFIX} onMessage: Processing serverContent.modelTurn...`);
        let parts: Part[] = serverContent.modelTurn.parts || [];
        console.log(`${LOG_PREFIX} onMessage: modelTurn has ${parts.length} parts.`);

        const audioParts = parts.filter(p =>
          p.inlineData?.mimeType?.startsWith('audio/pcm'),
        );
        console.log(`${LOG_PREFIX} onMessage: Found ${audioParts.length} audio parts.`);
        const base64s = audioParts.map(p => p.inlineData?.data);
        
        // --- FIX: Replace lodash.difference ---
        const otherParts = parts.filter(p => !p.inlineData?.mimeType?.startsWith('audio/pcm'));
        // --- END FIX ---
        
        console.log(`${LOG_PREFIX} onMessage: Found ${otherParts.length} other parts.`);

        base64s.forEach(b64 => {
          if (b64) {
            console.log(`${LOG_PREFIX} onMessage: Processing audio part...`);
            const data = base64ToArrayBuffer(b64);
            console.log(`${LOG_PREFIX} onMessage: Emitting 'audio' with ${data.byteLength} bytes.`);
            this.emitter.emit('audio', data as ArrayBuffer);
            this.log(`server.audio`, `buffer (${data.byteLength})`);
          }
        });

        if (otherParts.length > 0) {
          console.log(`${LOG_PREFIX} onMessage: Processing other parts...`);
          const content: LiveServerContent = { modelTurn: { parts: otherParts } };
          console.log(`${LOG_PREFIX} onMessage: Emitting 'content'.`);
          this.emitter.emit('content', content);
          this.log(`server.content`, message);
        }
      }

      if (serverContent.turnComplete) {
        console.log(`${LOG_PREFIX} onMessage: turnComplete. Emitting 'turncomplete'.`);
        this.log('server.send', 'turnComplete');
        this.emitter.emit('turncomplete');
      }

      if ((serverContent as any).generationComplete) {
        console.log(`${LOG_PREFIX} onMessage: generationComplete. Emitting 'generationcomplete'.`);
        this.log('server.send', 'generationComplete');
        this.emitter.emit('generationcomplete');
      }
    }
  }

  protected onError(e: ErrorEvent) {
    console.error(`${LOG_PREFIX} onError() FIRED:`, e);
    this._status = 'disconnected';
    console.log(`${LOG_PREFIX} onError: Set status to 'disconnected'.`);

    const message = `Could not connect to GenAI Live: ${e.message}`;
    this.log(`server.${e.type}`, message);
    this.emitter.emit('error', e);
  }

  protected onOpen() {
    console.log(`${LOG_PREFIX} onOpen() FIRED.`);
    this._status = 'connected';
    console.log(`${LOG_PREFIX} onOpen: Set status to 'connected'.`);
    this.emitter.emit('open');
  }

  protected onClose(e: CloseEvent) {
    console.log(`${LOG_PREFIX} onClose() FIRED. Code: ${e.code}, Reason: ${e.reason}, WasClean: ${e.wasClean}`);
    this._status = 'disconnected';
    console.log(`${LOG_PREFIX} onClose: Set status to 'disconnected'.`);
    let reason = e.reason || '';
    if (reason.toLowerCase().includes('error')) {
      const prelude = 'ERROR]';
      const preludeIndex = reason.indexOf(prelude);
      if (preludeIndex > 0) {
        reason = reason.slice(preludeIndex + prelude.length + 1, Infinity);
      }
    }

    this.log(
      `server.${e.type}`,
      `disconnected ${reason ? `with reason: ${reason}` : ``}`
    );
    this.emitter.emit('close', e);
  }

  protected log(type: string, message: string | object) {
    console.log(`${LOG_PREFIX} log() called. Type: ${type}, Message:`, message);
    this.emitter.emit('log', {
      type,
      message,
      date: new Date(),
    });
  }
}