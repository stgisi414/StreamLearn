// stgisi414/streamlearn/StreamLearn-5da6eca49904e01182e33e017b9792764ef017c0/lib/audio-recorder.ts
import EventEmitter from 'eventemitter3';

// --- LOGGING ---
const LOG_PREFIX = '[DEBUG_LIVE_RECORDER_NEW]';
console.log(`${LOG_PREFIX} File loaded.`);

const workletCode = `
class AudioProcessingWorklet extends AudioWorkletProcessor {
  buffer = new Int16Array(2048);
  bufferWriteIndex = 0;
  constructor() {
    super();
    console.log('${LOG_PREFIX} Worklet constructor() called.');
  }
  
  sendAndClearBuffer(){
    this.port.postMessage(this.buffer.slice(0, this.bufferWriteIndex).buffer);
    this.bufferWriteIndex = 0;
  }

  process(inputs) {
    if (inputs[0] && inputs[0].length > 0) {
      const channelData = inputs[0][0];
      if (channelData) {
        for (let i = 0; i < channelData.length; i++) {
          const int16Value = Math.max(-1, Math.min(1, channelData[i])) * 32767;
          this.buffer[this.bufferWriteIndex++] = int16Value;
          
          if(this.bufferWriteIndex >= this.buffer.length) {
            this.sendAndClearBuffer();
          }
        }
      }
    }
    return true; // Keep processor alive
  }
}
registerProcessor("audio-processing-worklet", AudioProcessingWorklet);
`;

export class AudioRecorder {
  private emitter = new EventEmitter();
  public on = this.emitter.on.bind(this.emitter);
  public off = this.emitter.off.bind(this.emitter);

  private stream: MediaStream | undefined;
  private audioContext: AudioContext | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private workletNode: AudioWorkletNode | undefined;
  private isRecording: boolean = false;

  constructor(private targetSampleRate = 16000) {
    console.log(`${LOG_PREFIX} constructor() called. Target rate: ${targetSampleRate}`);
  }

  async start() {
    console.log(`${LOG_PREFIX} start() called.`);
    if (this.isRecording) {
      console.warn(`${LOG_PREFIX} Already recording.`);
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log(`${LOG_PREFIX} Media stream obtained.`);

      this.audioContext = new AudioContext({
        sampleRate: this.targetSampleRate,
      });
      console.log(`${LOG_PREFIX} AudioContext created with sample rate ${this.audioContext.sampleRate}`);

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const workletURL = URL.createObjectURL(blob);
      
      try {
        await this.audioContext.audioWorklet.addModule(workletURL);
        console.log(`${LOG_PREFIX} AudioWorklet module added.`);
      } catch (e) {
         console.error(`${LOG_PREFIX} Error adding AudioWorklet module:`, e);
         throw new Error(`Failed to add audio worklet: ${(e as Error).message}`);
      }

      this.source = this.audioContext.createMediaStreamSource(this.stream);
      console.log(`${LOG_PREFIX} MediaStreamSource created.`);
      
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processing-worklet');
      console.log(`${LOG_PREFIX} AudioWorkletNode created.`);

      this.workletNode.port.onmessage = (event) => {
        // event.data is ArrayBuffer
        this.emitter.emit('data', event.data);
      };
      
      this.source.connect(this.workletNode);
      console.log(`${LOG_PREFIX} Source connected to worklet.`);
      
      this.isRecording = true;
      console.log(`${LOG_PREFIX} Recording started.`);
      
    } catch (err) {
      console.error(`${LOG_PREFIX} start() FAILED.`, err);
      this.stop(); // Clean up on failure
      throw err;
    }
  }

  stop() {
    console.log(`${LOG_PREFIX} stop() called.`);
    this.isRecording = false;
    
    if (this.source) {
      this.source.disconnect();
      this.source = undefined;
      console.log(`${LOG_PREFIX} Source disconnected.`);
    }

    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = undefined;
      console.log(`${LOG_PREFIX} Worklet node disconnected.`);
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = undefined;
      console.log(`${LOG_PREFIX} MediaStream tracks stopped.`);
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = undefined;
      console.log(`${LOG_PREFIX} AudioContext closed.`);
    }
  }
}