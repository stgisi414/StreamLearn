// stgisi414/streamlearn/StreamLearn-9282341a63ce7e0d409702bc90f81e24e5098e1e/lib/audio-recorder.ts
import { audioContext } from './utils';
import AudioRecordingWorklet from './worklets/audio-processing';
import { createWorketFromSrc } from './audioworklet-registry';
import EventEmitter from 'eventemitter3';

// --- LOGGING ---
const LOG_PREFIX = '[DEBUG_LIVE_RECORDER]';
console.log(`${LOG_PREFIX} File loaded.`);
// --- END LOGGING ---

function arrayBufferToBase64(buffer: ArrayBuffer) {
  console.log(`${LOG_PREFIX} arrayBufferToBase64() called with buffer size: ${buffer.byteLength}`);
  var binary = '';
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = window.btoa(binary);
  console.log(`${LOG_PREFIX} arrayBufferToBase64: Returning base64 string (length: ${base64.length}).`);
  return base64;
}

export class AudioRecorder {
  private emitter = new EventEmitter();
  public on = this.emitter.on.bind(this.emitter);
  public off = this.emitter.off.bind(this.emitter);

  stream: MediaStream | undefined;
  audioContext: AudioContext | undefined;
  source: MediaStreamAudioSourceNode | undefined;
  recording: boolean = false;
  recordingWorklet: AudioWorkletNode | undefined;

  private starting: Promise<void> | null = null;

  constructor(public sampleRate = 16000) {
    console.log(`${LOG_PREFIX} constructor() called. Sample rate: ${sampleRate}`);
  }

  async start() {
    console.log(`${LOG_PREFIX} start() called.`);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error(`${LOG_PREFIX} start: getUserMedia not supported.`);
      throw new Error('Could not request user media');
    }

    if (this.starting) {
      console.warn(`${LOG_PREFIX} start: Already starting. Returning existing promise.`);
      return this.starting;
    }

    console.log(`${LOG_PREFIX} start: Creating new starting promise.`);
    this.starting = new Promise(async (resolve, reject) => {
      console.log(`${LOG_PREFIX} start (promise): Executing...`);
      try {
        console.log(`${LOG_PREFIX} start (promise): Requesting user media...`);
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log(`${LOG_PREFIX} start (promise): User media stream obtained.`);
        
        console.log(`${LOG_PREFIX} start (promise): Creating AudioContext with sample rate ${this.sampleRate}...`);
        this.audioContext = await audioContext({ sampleRate: this.sampleRate });
        console.log(`${LOG_PREFIX} start (promise): AudioContext created. State: ${this.audioContext.state}`);

        console.log(`${LOG_PREFIX} start (promise): Creating MediaStreamAudioSourceNode...`);
        this.source = this.audioContext.createMediaStreamSource(this.stream);
        console.log(`${LOG_PREFIX} start (promise): MediaStreamAudioSourceNode created.`);

        const workletName = 'audio-recorder-worklet';
        console.log(`${LOG_PREFIX} start (promise): Creating worklet source for '${workletName}'...`);
        const src = createWorketFromSrc(workletName, AudioRecordingWorklet);
        console.log(`${LOG_PREFIX} start (promise): Worklet source created (Blob URL).`);

        console.log(`${LOG_PREFIX} start (promise): Adding audioWorklet module...`);
        await this.audioContext.audioWorklet.addModule(src);
        console.log(`${LOG_PREFIX} start (promise): audioWorklet module added.`);

        console.log(`${LOG_PREFIX} start (promise): Creating AudioWorkletNode...`);
        this.recordingWorklet = new AudioWorkletNode(
          this.audioContext,
          workletName
        );
        console.log(`${LOG_PREFIX} start (promise): AudioWorkletNode created.`);

        console.log(`${LOG_PREFIX} start (promise): Setting up worklet port.onmessage...`);
        this.recordingWorklet.port.onmessage = async (ev: MessageEvent) => {
          console.log(`${LOG_PREFIX} worklet.port.onmessage: Message received from worklet.`);
          const arrayBuffer = ev.data.data.int16arrayBuffer;

          if (arrayBuffer) {
            console.log(`${LOG_PREFIX} worklet.port.onmessage: Received ArrayBuffer size: ${arrayBuffer.byteLength}`);
            const arrayBufferString = arrayBufferToBase64(arrayBuffer);
            console.log(`${LOG_PREFIX} worklet.port.onmessage: Emitting 'data' event.`);
            this.emitter.emit('data', arrayBufferString);
          } else {
            console.warn(`${LOG_PREFIX} worklet.port.onmessage: Received message but no arrayBuffer.`);
          }
        };
        
        console.log(`${LOG_PREFIX} start (promise): Connecting source to recordingWorklet.`);
        this.source.connect(this.recordingWorklet);
        
        this.recording = true;
        console.log(`${LOG_PREFIX} start (promise): Set recording=true. Resolving promise.`);
        resolve();
      } catch (err) {
        console.error(`${LOG_PREFIX} start (promise): FAILED.`, err);
        reject(err);
      } finally {
        console.log(`${LOG_PREFIX} start (promise): finally block. Setting this.starting = null.`);
        this.starting = null;
      }
    });
    
    await this.starting;
  }

  stop() {
    console.log(`${LOG_PREFIX} stop() called.`);
    
    const handleStop = () => {
      console.log(`${LOG_PREFIX} stop (handleStop): Executing stop logic...`);
      if (this.source) {
        this.source.disconnect();
        this.source = undefined;
        console.log(`${LOG_PREFIX} stop (handleStop): Source disconnected.`);
      } else {
        console.log(`${LOG_PREFIX} stop (handleStop): No source to disconnect.`);
      }

      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = undefined;
        console.log(`${LOG_PREFIX} stop (handleStop): MediaStream tracks stopped.`);
      } else {
        console.log(`${LOG_PREFIX} stop (handleStop): No MediaStream.`);
      }

      this.recordingWorklet = undefined;
      console.log(`${LOG_PREFIX} stop (handleStop): recordingWorklet set to undefined.`);
      this.recording = false;
      console.log(`${LOG_PREFIX} stop (handleStop): recording set to false.`);
    };

    if (this.starting) {
      console.log(`${LOG_PREFIX} stop: Start is still in progress. Will stop after it finishes.`);
      this.starting.then(handleStop);
      return;
    }
    
    handleStop();
  }
}