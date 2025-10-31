/**
 * This AudioWorkletProcessor downsamples 32-bit float audio
 * to 16-bit PCM audio and posts it back to the main thread.
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // The target sample rate (Gemini API requirement)
    this.targetSampleRate = options.processorOptions.targetSampleRate || 16000;
    // The native sample rate (from AudioContext)
    this.nativeSampleRate = sampleRate; 
    
    // Simple resampling ratio
    this.resampleRatio = this.nativeSampleRate / this.targetSampleRate;
    
    this.buffer = [];
    this.nextSample = 0.0;
  }

  /**
   * Convert 32-bit float audio to 16-bit PCM.
   * @param {Float32Array} input - The audio data from the microphone.
   * @returns {Int16Array} - The 16-bit PCM audio data.
   */
  floatTo16BitPCM(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
  }

  process(inputs, outputs, parameters) {
    // We only care about the first input (mono mic)
    const input = inputs[0];
    const inputChannel = input[0];

    if (!inputChannel) {
      return true;
    }

    // Simple linear interpolation for downsampling
    const resampled = [];
    let i = 0;
    while (this.nextSample < inputChannel.length) {
        // Get the two nearest samples
        const low = Math.floor(this.nextSample);
        const high = Math.ceil(this.nextSample);
        const frac = this.nextSample - low;
        
        // Interpolate (or just take the nearest sample if at the edge)
        const sample = (1 - frac) * inputChannel[low] + (high >= inputChannel.length ? 0 : frac * inputChannel[high]);
        resampled.push(sample);
        
        this.nextSample += this.resampleRatio;
    }
    
    // Reset nextSample for the next block
    this.nextSample -= inputChannel.length;

    if (resampled.length > 0) {
      // Convert to 16-bit PCM
      const pcmData = this.floatTo16BitPCM(new Float32Array(resampled));
      
      // Post the raw PCM buffer back to the main thread
      this.port.postMessage(pcmData.buffer, [pcmData.buffer]);
    }

    return true; // Keep the processor alive
  }
}

registerProcessor('audio-processor', AudioProcessor);