// stgisi414/streamlearn/StreamLearn-9282341a63ce7e0d409702bc90f81e24e5098e1e/lib/audioworklet-registry.ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
// ... (license header) ...

// --- LOGGING ---
const LOG_PREFIX = '[DEBUG_LIVE_WORKLET_REGISTRY]';
console.log(`${LOG_PREFIX} File loaded.`);
// --- END LOGGING ---

export type WorkletGraph = {
  node?: AudioWorkletNode;
  handlers: Array<(this: MessagePort, ev: MessageEvent) => any>;
};

console.log(`${LOG_PREFIX} Creating registeredWorklets Map.`);
export const registeredWorklets: Map<
  AudioContext,
  Record<string, WorkletGraph>
> = new Map();

export const createWorketFromSrc = (
  workletName: string,
  workletSrc: string
) => {
  console.log(`${LOG_PREFIX} createWorketFromSrc() called for: ${workletName}`);
  const scriptContent = `registerProcessor("${workletName}", ${workletSrc})`;
  console.log(`${LOG_PREFIX} createWorketFromSrc: Worklet script content length: ${scriptContent.length}`);
  const script = new Blob(
    [scriptContent],
    {
      type: 'application/javascript',
    }
  );
  console.log(`${LOG_PREFIX} createWorketFromSrc: Blob created.`);
  const url = URL.createObjectURL(script);
  console.log(`${LOG_PREFIX} createWorketFromSrc: Returning Blob URL: ${url}`);
  return url;
};