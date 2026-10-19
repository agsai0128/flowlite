// Capture window: records the mic, resamples to 16 kHz mono PCM16, streams chunks
// to main, and shows the listening indicator. Runs as a plain <script> (no imports).

interface FlowApi {
  sendAudio: (pcm: ArrayBuffer) => void;
  captureStopped: () => void;
  captureError: (msg: string) => void;
  onControl: (cb: (cmd: 'start' | 'stop') => void) => void;
  onState: (cb: (s: string) => void) => void;
  onHandsFree: (cb: () => void) => void;
  onPartial: (cb: (t: string) => void) => void;
  onError: (cb: (m: string) => void) => void;
}
interface Window { flow: FlowApi; }

(() => {
  const flow = window.flow;
  const bar = document.getElementById('bar') as HTMLDivElement;
  const label = document.getElementById('label') as HTMLDivElement;
  const textEl = document.getElementById('text') as HTMLDivElement;

  let audioCtx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let stream: MediaStream | null = null;

  function downsampleTo16k(input: Float32Array, inRate: number): Int16Array {
    const ratio = inRate / 16000;
    const outLen = Math.max(1, Math.floor(input.length / ratio));
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      let s = input[Math.floor(i * ratio)];
      s = Math.max(-1, Math.min(1, s));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  async function start() {
    if (stream) return; // already capturing
    textEl.textContent = '';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      flow.captureError('microphone unavailable: ' + (e as Error).message);
      return;
    }
    audioCtx = new AudioContext();
    await audioCtx.resume();
    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    const inRate = audioCtx.sampleRate;
    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const input = e.inputBuffer.getChannelData(0);
      const pcm = downsampleTo16k(input, inRate);
      // copy into a fresh ArrayBuffer to send to main
      const ab = new ArrayBuffer(pcm.byteLength);
      new Int16Array(ab).set(pcm);
      flow.sendAudio(ab);
    };
    source.connect(processor);
    processor.connect(audioCtx.destination); // keep node alive; output is silent
  }

  function stop() {
    try { processor?.disconnect(); } catch { /* */ }
    try { source?.disconnect(); } catch { /* */ }
    stream?.getTracks().forEach((t) => t.stop());
    void audioCtx?.close();
    processor = null; source = null; stream = null; audioCtx = null;
    flow.captureStopped();
  }

  // Hands-free (double-tap) keeps listening with no key held; show it in the bar.
  let handsFree = false;

  flow.onControl((cmd) => { if (cmd === 'start') void start(); else stop(); });
  flow.onState((s) => {
    if (s !== 'listening') handsFree = false; // a new session starts not-hands-free
    bar.className = handsFree ? s + ' handsfree' : s;
    label.textContent =
      s === 'listening' ? (handsFree ? 'Hands-free' : 'Listening')
      : s === 'finalizing' ? 'Finishing'
      : 'Idle';
    if (s === 'idle') textEl.textContent = '';
  });
  flow.onHandsFree(() => {
    handsFree = true;
    bar.classList.add('handsfree');
    label.textContent = 'Hands-free';
  });
  flow.onPartial((t) => { textEl.textContent = t; });
  flow.onError((m) => { label.textContent = 'Error'; textEl.textContent = '⚠ ' + m; });
})();
