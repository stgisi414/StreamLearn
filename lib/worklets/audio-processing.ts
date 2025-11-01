// stgisi414/streamlearn/StreamLearn-9282341a63ce7e0d409702bc90f81e24e5098e1e/lib/worklets/audio-processing.ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
// ... (license header) ...

// --- LOGGING ---
const LOG_PREFIX = '[DEBUG_LIVE_WORKLET_RECORDER]';
console.log(`${LOG_PREFIX} File loaded.`);
// --- END LOGGING ---

const AudioRecordingWorklet = `
class AudioProcessingWorklet extends AudioWorkletProcessor {

  buffer = new Int16Array(2048);
  bufferWriteIndex = 0;

  constructor() {
    super();
    this.hasAudio = false;
    console.log('${LOG_PREFIX} Worklet constructor() called.');
  }

  process(inputs) {
    // console.log('${LOG_PREFIX} process() called.'); // This is too noisy
    if (inputs[0] && inputs[0].length > 0) {
      const channel0 = inputs[0][0];
      if (channel0) {
        // console.log('${LOG_PREFIX} process: Processing chunk of length: ' + channel0.length); // Too noisy
        this.processChunk(channel0);
      }
    }
    return true; // Keep processor alive
  }

  sendAndClearBuffer(){
    console.log('${LOG_PREFIX} sendAndClearBuffer() called. Write index: ' + this.bufferWriteIndex);
    this.port.postMessage({
      event: "chunk",
      data: {
        int16arrayBuffer: this.buffer.slice(0, this.bufferWriteIndex).buffer,
      },
    });
    console.log('${LOG_PREFIX} sendAndClearBuffer: Message posted to main thread.');
    this.bufferWriteIndex = 0;
  }

  processChunk(float32Array) {
    const l = float32Array.length;
    
    for (let i = 0; i < l; i++) {
      const int16Value = float32Array[i] * 32768;
      this.buffer[this.bufferWriteIndex++] = int16Value;
      
      if(this.bufferWriteIndex >= this.buffer.length) {
        // console.log('${LOG_PREFIX} processChunk: Buffer full, sending.'); // Too noisy
        this.sendAndClearBuffer();
      }
    }

    if(this.bufferWriteIndex >= this.buffer.length) {
      // This case should be redundant, but good to keep
      console.log('${LOG_PREFIX} processChunk: Buffer full (post-loop check), sending.');
      this.sendAndClearBuffer();
    }
  }
}
`;

export default AudioRecordingWorklet;