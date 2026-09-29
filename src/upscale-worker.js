// Runs the Real-ESRGAN general x4v3 upscale model (BSD 3-Clause) off the main thread.
import * as ort from 'onnxruntime-web/webgpu';

ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

let session = null;
let provider = null;

async function create(model) {
  const hasGpu = !!self.navigator?.gpu && !!(await self.navigator.gpu.requestAdapter().catch(() => null));
  if (hasGpu) {
    try {
      session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] });
      provider = 'gpu';
      return;
    } catch (e) {
      console.warn('WebGPU session failed, using CPU', e);
    }
  }
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  provider = 'cpu';
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await create(data.model);
      self.postMessage({ type: 'ready', provider });
    } else if (data.type === 'run') {
      const input = new ort.Tensor('float32', data.input, [1, 3, data.h, data.w]);
      const out = await session.run({ input });
      const copy = new Float32Array(out.output.data);
      self.postMessage({ type: 'out', data: copy }, [copy.buffer]);
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e?.message || e) });
  }
};
