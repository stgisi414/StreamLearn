// stgisi414/streamlearn/StreamLearn-9282341a63ce7e0d409702bc90f81e24e5098e1e/lib/audio-streamer.ts
import {
  createWorketFromSrc,
  registeredWorklets,
} from './audioworklet-registry';

// --- LOGGING ---
const LOG_PREFIX = '[DEBUG_LIVE_STREAMER]';
console.log(`${LOG_PREFIX} File loaded.`);
// --- END LOGGING ---

export class AudioStreamer {
  // *** THE FIX: Match the recorder's sample rate ***
  private sampleRate: number = 16000;
  // *** END FIX ***
  private bufferSize: number = 7680; // This buffer size is fine
  private audioQueue: Float32Array[] = [];
// ... (rest of the file is unchanged, all logs are preserved) ...
  private isPlaying: boolean = false;
  private isStreamComplete: boolean = false;
  private checkInterval: number | null = null;
  private scheduledTime: number = 0;
  private initialBufferTime: number = 0.1; // 100ms initial buffer
  public gainNode: GainNode;
  public source: AudioBufferSourceNode;
  private endOfQueueAudioSource: AudioBufferSourceNode | null = null;

  public onComplete = () => {
    console.log(`${LOG_PREFIX} onComplete() default handler called.`);
  };

  constructor(public context: AudioContext) {
    console.log(`${LOG_PREFIX} constructor() called. Context state: ${context.state}`);
    this.gainNode = this.context.createGain();
    console.log(`${LOG_PREFIX} constructor: GainNode created.`);
    this.source = this.context.createBufferSource();
    console.log(`${LOG_PREFIX} constructor: BufferSource created.`);
    this.gainNode.connect(this.context.destination);
    console.log(`${LOG_PREFIX} constructor: GainNode connected to destination.`);
    this.addPCM16 = this.addPCM16.bind(this);
    console.log(`${LOG_PREFIX} constructor: addPCM16 bound.`);
  }

  async addWorklet<T extends (d: any) => void>(
    workletName: string,
    workletSrc: string,
    handler: T
  ): Promise<this> {
    console.log(`${LOG_PREFIX} addWorklet() called for: ${workletName}`);
    let workletsRecord = registeredWorklets.get(this.context);
    if (workletsRecord && workletsRecord[workletName]) {
      console.log(`${LOG_PREFIX} addWorklet: Worklet already exists. Adding handler.`);
      workletsRecord[workletName].handlers.push(handler);
      return Promise.resolve(this);
    }

    if (!workletsRecord) {
      console.log(`${LOG_PREFIX} addWorklet: No record for this AudioContext. Creating new one.`);
      registeredWorklets.set(this.context, {});
      workletsRecord = registeredWorklets.get(this.context)!;
    }

    console.log(`${LOG_PREFIX} addWorklet: Creating new worklet record.`);
    workletsRecord[workletName] = { handlers: [handler] };

    console.log(`${LOG_PREFIX} addWorklet: Creating worklet source...`);
    const src = createWorketFromSrc(workletName, workletSrc);
    console.log(`${LOG_PREFIX} addWorklet: Adding module...`);
    await this.context.audioWorklet.addModule(src);
    console.log(`${LOG_PREFIX} addWorklet: Creating AudioWorkletNode...`);
    const worklet = new AudioWorkletNode(this.context, workletName);

    console.log(`${LOG_PREFIX} addWorklet: Storing node in record.`);
    workletsRecord[workletName].node = worklet;

    return this;
  }

  private _processPCM16Chunk(chunk: Uint8Array): Float32Array {
    console.log(`${LOG_PREFIX} _processPCM16Chunk() called with chunk size: ${chunk.length}`);
    const float32Array = new Float32Array(chunk.length / 2);
    const dataView = new DataView(chunk.buffer);

    for (let i = 0; i < chunk.length / 2; i++) {
      try {
        const int16 = dataView.getInt16(i * 2, true);
        float32Array[i] = int16 / 32768;
      } catch (e) {
        console.error(`${LOG_PREFIX} _processPCM16Chunk: Error processing sample ${i}:`, e);
      }
    }
    console.log(`${LOG_PREFIX} _processPCM16Chunk: Converted to Float32Array length: ${float32Array.length}`);
    return float32Array;
  }

  addPCM16(chunk: Uint8Array) {
    console.log(`${LOG_PREFIX} addPCM16() called with chunk size: ${chunk.length}`);
    this.isStreamComplete = false;
    let processingBuffer = this._processPCM16Chunk(chunk);
    
    console.log(`${LOG_PREFIX} addPCM16: Processing buffer...`);
    while (processingBuffer.length >= this.bufferSize) {
      console.log(`${LOG_PREFIX} addPCM16: Slicing buffer (size ${this.bufferSize}) and pushing to queue.`);
      const buffer = processingBuffer.slice(0, this.bufferSize);
      this.audioQueue.push(buffer);
      processingBuffer = processingBuffer.slice(this.bufferSize);
    }
    if (processingBuffer.length > 0) {
      console.log(`${LOG_PREFIX} addPCM16: Pushing remaining buffer (size ${processingBuffer.length}) to queue.`);
      this.audioQueue.push(processingBuffer);
    }
    
    if (!this.isPlaying) {
      console.log(`${LOG_PREFIX} addPCM16: Not currently playing. Starting playback...`);
      this.isPlaying = true;
      this.scheduledTime = this.context.currentTime + this.initialBufferTime;
      console.log(`${LOG_PREFIX} addPCM16: Initial scheduledTime set to: ${this.scheduledTime}`);
      this.scheduleNextBuffer();
    } else {
      console.log(`${LOG_PREFIX} addPCM16: Already playing. Queue length is now: ${this.audioQueue.length}`);
    }
  }

  private createAudioBuffer(audioData: Float32Array): AudioBuffer {
    console.log(`${LOG_PREFIX} createAudioBuffer() called with data length: ${audioData.length}`);
    const audioBuffer = this.context.createBuffer(
      1,
      audioData.length,
      this.sampleRate // This will now be 16000
    );
    audioBuffer.getChannelData(0).set(audioData);
    console.log(`${LOG_PREFIX} createAudioBuffer: Buffer created (duration: ${audioBuffer.duration}s).`);
    return audioBuffer;
  }

  private scheduleNextBuffer() {
    console.log(`${LOG_PREFIX} scheduleNextBuffer() called. Queue length: ${this.audioQueue.length}. Scheduled time: ${this.scheduledTime}. Current time: ${this.context.currentTime}`);
    const SCHEDULE_AHEAD_TIME = 0.2;

    while (
      this.audioQueue.length > 0 &&
      this.scheduledTime < this.context.currentTime + SCHEDULE_AHEAD_TIME
    ) {
      console.log(`${LOG_PREFIX} scheduleNextBuffer: Scheduling a buffer.`);
      const audioData = this.audioQueue.shift()!;
      console.log(`${LOG_PREFIX} scheduleNextBuffer: Dequeued buffer length: ${audioData.length}`);
      const audioBuffer = this.createAudioBuffer(audioData);
      const source = this.context.createBufferSource();
      console.log(`${LOG_PREFIX} scheduleNextBuffer: Created BufferSourceNode.`);

      if (this.audioQueue.length === 0) {
        console.log(`${LOG_PREFIX} scheduleNextBuffer: This is the last buffer in queue. Setting onended handler.`);
        if (this.endOfQueueAudioSource) {
          console.log(`${LOG_PREFIX} scheduleNextBuffer: Clearing old onended handler.`);
          this.endOfQueueAudioSource.onended = null;
        }
        this.endOfQueueAudioSource = source;
        source.onended = () => {
          console.log(`${LOG_PREFIX} source.onended: FIRED.`);
          if (
            !this.audioQueue.length &&
            this.endOfQueueAudioSource === source
          ) {
            console.log(`${LOG_PREFIX} source.onended: Queue is still empty and this is the correct source. Firing onComplete().`);
            this.endOfQueueAudioSource = null;
            this.onComplete();
          } else {
            console.log(`${LOG_PREFIX} source.onended: Queue has new items or source mismatch. Not firing onComplete().`);
          }
        };
      }

      source.buffer = audioBuffer;
      source.connect(this.gainNode);
      console.log(`${LOG_PREFIX} scheduleNextBuffer: Source connected to gainNode.`);

      const worklets = registeredWorklets.get(this.context);

      if (worklets) {
        console.log(`${LOG_PREFIX} scheduleNextBuffer: Attaching worklets...`);
        Object.entries(worklets).forEach(([workletName, graph]) => {
          const { node, handlers } = graph;
          if (node) {
            console.log(`${LOG_PREFIX} scheduleNextBuffer: Connecting source to worklet: ${workletName}`);
            source.connect(node);
            node.port.onmessage = function (ev: MessageEvent) {
              console.log(`${LOG_PREFIX} worklet.onmessage: Message from ${workletName}.`);
              handlers.forEach(handler => {
                handler.call(node.port, ev);
              });
            };
            node.connect(this.context.destination);
          }
        });
      }
      
      const startTime = Math.max(this.scheduledTime, this.context.currentTime);
      console.log(`${LOG_PREFIX} scheduleNextBuffer: Scheduling source.start(${startTime})`);
      source.start(startTime);
      this.scheduledTime = startTime + audioBuffer.duration;
      console.log(`${LOG_PREFIX} scheduleNextBuffer: New scheduledTime: ${this.scheduledTime}`);
    }

    if (this.audioQueue.length === 0) {
      console.log(`${LOG_PREFIX} scheduleNextBuffer: Queue is empty.`);
      if (this.isStreamComplete) {
        console.log(`${LOG_PREFIX} scheduleNextBuffer: Stream is complete. Setting isPlaying=false.`);
        this.isPlaying = false;
        if (this.checkInterval) {
          console.log(`${LOG_PREFIX} scheduleNextBuffer: Clearing checkInterval.`);
          clearInterval(this.checkInterval);
          this.checkInterval = null;
        }
      } else {
        if (!this.checkInterval) {
          console.log(`${LOG_PREFIX} scheduleNextBuffer: Queue empty but stream not complete. Starting checkInterval.`);
          this.checkInterval = window.setInterval(() => {
            console.log(`${LOG_PREFIX} checkInterval: FIRED. Queue length: ${this.audioQueue.length}`);
            if (this.audioQueue.length > 0) {
              console.log(`${LOG_PREFIX} checkInterval: Found new audio in queue. Scheduling...`);
              this.scheduleNextBuffer();
            }
          }, 100) as unknown as number;
        } else {
          console.log(`${LOG_PREFIX} scheduleNextBuffer: checkInterval already running.`);
        }
      }
    } else {
      console.log(`${LOG_PREFIX} scheduleNextBuffer: Queue not empty, scheduling next check.`);
      const nextCheckTime =
        (this.scheduledTime - this.context.currentTime) * 1000;
      console.log(`${LOG_PREFIX} scheduleNextBuffer: Next check in ${Math.max(0, nextCheckTime - 50)} ms.`);
      setTimeout(
        () => this.scheduleNextBuffer(),
        Math.max(0, nextCheckTime - 50)
      );
    }
  }

  stop() {
    console.log(`${LOG_PREFIX} stop() called.`);
    this.isPlaying = false;
    this.isStreamComplete = true;
    this.audioQueue = [];
    console.log(`${LOG_PREFIX} stop: Queue cleared.`);
    this.scheduledTime = this.context.currentTime;
    console.log(`${LOG_PREFIX} stop: scheduledTime reset.`);

    if (this.checkInterval) {
      console.log(`${LOG_PREFIX} stop: Clearing checkInterval.`);
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    console.log(`${LOG_PREFIX} stop: Ramping gain down.`);
    this.gainNode.gain.linearRampToValueAtTime(
      0,
      this.context.currentTime + 0.1
    );

    setTimeout(() => {
      console.log(`${LOG_PREFIX} stop (timeout): Disconnecting old gainNode and creating new one.`);
      this.gainNode.disconnect();
      this.gainNode = this.context.createGain();
      this.gainNode.connect(this.context.destination);
    }, 200);
  }

  async resume() {
    console.log(`${LOG_PREFIX} resume() called. Context state: ${this.context.state}`);
    if (this.context.state === 'suspended') {
      console.log(`${LOG_PREFIX} resume: Resuming AudioContext...`);
      await this.context.resume();
      console.log(`${LOG_PREFIX} resume: AudioContext resumed. New state: ${this.context.state}`);
    }
    this.isStreamComplete = false;
    this.scheduledTime = this.context.currentTime + this.initialBufferTime;
    console.log(`${LOG_PREFIX} resume: scheduledTime reset to: ${this.scheduledTime}`);
    this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
    console.log(`${LOG_PREFIX} resume: Gain set to 1.`);
  }

  complete() {
    console.log(`${LOG_PREFIX} complete() called. Setting isStreamComplete=true.`);
    this.isStreamComplete = true;
    console.log(`${LOG_PREFIX} complete: Calling onComplete() handler.`);
    this.onComplete();
  }
}