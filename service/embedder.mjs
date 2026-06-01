// Local ONNX-runtime embedder for symbol semantic search.
// Lazy-loads @huggingface/transformers + Xenova/all-MiniLM-L6-v2 (384-dim)
// on first call. The first call also downloads the model (~25 MB) to the
// transformers.js cache; subsequent loads are warm.

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIMS = 384;
const MAX_BATCH = 32;

let pipelinePromise = null;
let pipelineFn = null;
let loadError = null;

async function getPipeline() {
  if (pipelineFn) return pipelineFn;
  if (loadError) throw loadError;
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const mod = await import("@huggingface/transformers");
      // transformers.js defaults to caching inside node_modules which is
      // read-only for the unprivileged container user. Force the volume.
      const cacheDir = process.env.TRANSFORMERS_CACHE || "/app/.cache/huggingface";
      mod.env.cacheDir = cacheDir;
      mod.env.allowLocalModels = false;
      const fn = await mod.pipeline("feature-extraction", MODEL);
      pipelineFn = fn;
      console.log(`embedder: loaded ${MODEL} (${DIMS}d) [cache=${cacheDir}]`);
      return fn;
    })().catch((e) => { loadError = e; throw e; });
  }
  return pipelinePromise;
}

export const EMBEDDING_DIMS = DIMS;

export async function embedQuery(text) {
  const fn = await getPipeline();
  const out = await fn(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

export async function embedBatch(texts) {
  if (!texts.length) return [];
  const fn = await getPipeline();
  const out = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const slice = texts.slice(i, i + MAX_BATCH);
    const tensor = await fn(slice, { pooling: "mean", normalize: true });
    // tensor.data is a Float32Array of length slice.length * DIMS
    for (let j = 0; j < slice.length; j++) {
      const start = j * DIMS;
      out.push(Array.from(tensor.data.slice(start, start + DIMS)));
    }
  }
  return out;
}

export function vectorLiteral(vec) {
  // pgvector accepts JSON-array-style text literals via ::vector cast.
  return "[" + vec.join(",") + "]";
}
