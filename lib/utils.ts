// stgisi414/streamlearn/StreamLearn-9282341a63ce7e0d409702bc90f81e24e5098e1e/lib/utils.ts
// --- LOGGING ---
const LOG_PREFIX = '[DEBUG_LIVE_UTILS]';
console.log(`${LOG_PREFIX} File loaded.`);
// --- END LOGGING ---

export const audioContext = (
  options: AudioContextOptions
): Promise<AudioContext> => {
  console.log(`${LOG_PREFIX} audioContext() called with options:`, options);
  const context = new AudioContext(options);
  console.log(`${LOG_PREFIX} audioContext: New AudioContext created. State: ${context.state}`);
  return Promise.resolve(context);
};

export function base64ToArrayBuffer(base64: string): ArrayBufferLike {
  console.log(`${LOG_PREFIX} base64ToArrayBuffer() called with base64 length: ${base64.length}`);
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  console.log(`${LOG_PREFIX} base64ToArrayBuffer: Returning ArrayBuffer size: ${bytes.buffer.byteLength}`);
  return bytes.buffer;
}

export function base64AudioToBlob(base64String: string): Blob {
  console.log(`${LOG_PREFIX} base64AudioToBlob() called with base64 length: ${base64String.length}`);
  const buffer = base64ToArrayBuffer(base64String);
  const blob = new Blob([buffer], { type: 'audio/pcm' });
  console.log(`${LOG_PREFIX} base64AudioToBlob: Returning Blob size: ${blob.size}, type: ${blob.type}`);
  return blob;
}