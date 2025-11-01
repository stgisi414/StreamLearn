// stgisi414/streamlearn/StreamLearn-5da6eca49904e01182e33e017b9792764ef017c0/lib/audio-streamer.ts
import { base64ToArrayBuffer } from './utils';

// --- LOGGING ---
const LOG_PREFIX = '[DEBUG_LIVE_STREAMER_NEW]';
console.log(`${LOG_PREFIX} File loaded.`);

export class AudioStreamer {
  private audioContext: AudioContext;
  private audioQueue: ArrayBuffer[] = [];
  private isPlaying: boolean = false;
  private source: AudioBufferSourceNode | null = null;
  private startTime: number = 0;
  
  // Per Google's example, output audio is 24kHz
  private readonly sampleRate = 24000; 

  constructor() {
    console.log(`${LOG_PREFIX} constructor() called.`);
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    this.audioContext.resume(); // Resume context immediately
    console.log(`${LOG_PREFIX} AudioContext created with sample rate ${this.sampleRate}.`);
  }

  private async playNextChunk() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      console.log(`${LOG_PREFIX} Queue empty, stopping playback.`);
      return;
    }

    this.isPlaying = true;
    const arrayBuffer = this.audioQueue.shift()!;
    
    try {
      // Convert Int16 (from base64) to Float32
      const int16Array = new Int16Array(arrayBuffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32767; // Convert 16-bit int to float
      }

      const audioBuffer = this.audioContext.createBuffer(
        1, // 1 channel (mono)
        float32Array.length,
        this.sampleRate
      );
      
      audioBuffer.getChannelData(0).set(float32Array);

      this.source = this.audioContext.createBufferSource();
      this.source.buffer = audioBuffer;
      this.source.connect(this.audioContext.destination);

      this.source.onended = () => {
        console.log(`${LOG_PREFIX} Chunk finished playing.`);
        this.playNextChunk(); // Play next chunk when this one finishes
      };

      // Simple queueing: play immediately if it's the first chunk,
      // or schedule it right after the previous one finishes.
      const currentTime = this.audioContext.currentTime;
      if (currentTime < this.startTime) {
        // Schedule it
        console.log(`${LOG_PREFIX} Scheduling chunk at ${this.startTime}`);
        this.source.start(this.startTime);
        this.startTime += audioBuffer.duration;
      } else {
        // Play it now
        console.log(`${LOG_PREFIX} Playing chunk now at ${currentTime}`);
        this.source.start(currentTime);
        this.startTime = currentTime + audioBuffer.duration;
      }
      
    } catch (e) {
      console.error(`${LOG_PREFIX} Error playing audio chunk:`, e);
      // Try to play the next one
      this.playNextChunk();
    }
  }

  /**
   * Adds base64 encoded 16-bit PCM audio data to the playback queue.
   * @param base64Audio Base64 string of the audio data.
   */
  public addAudio(base64Audio: string) {
    try {
      const arrayBuffer = base64ToArrayBuffer(base64Audio);
      console.log(`${LOG_PREFIX} addAudio: Added ${arrayBuffer.byteLength} bytes to queue.`);
      this.audioQueue.push(arrayBuffer);
      
      if (!this.isPlaying) {
        console.log(`${LOG_PREFIX} addAudio: Not playing, starting playback.`);
        this.startTime = this.audioContext.currentTime; // Reset start time
        this.playNextChunk();
      }
    } catch (e) {
      console.error(`${LOG_PREFIX} Failed to decode base64 audio:`, e);
    }
  }

  /**
   * Stops playback and clears the queue.
   */
  public stop() {
    console.log(`${LOG_PREFIX} stop() called.`);
    this.audioQueue = []; // Clear queue
    if (this.source) {
      this.source.onended = null; // Remove listener
      this.source.stop();
      this.source = null;
    }
    this.isPlaying = false;
    this.startTime = 0;
    
    // It's good practice to re-create the context if you stop/start a lot
    if (this.audioContext.state !== 'closed') {
        this.audioContext.close();
    }
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    this.audioContext.resume();
  }
}