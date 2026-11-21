// Usage: node run_photo.js <model-key>     (one process per model = clean RAM)
// Photos in ./photos : 01_a.png 01_b.png 01_sosie.png  02_a.png ...
const fs = require("fs");
const path = require("path");

const MODELS = {
  "clip-b32": { id: "Xenova/clip-vit-base-patch32", kind: "clip" },
  "clip-b16": { id: "Xenova/clip-vit-base-patch16", kind: "clip" },
  siglip: { id: "Xenova/siglip-base-patch16-224", kind: "siglip" },
  "dino-s": { id: "Xenova/dinov2-small", kind: "dino" },
  "dino-b": { id: "Xenova/dinov2-base", kind: "dino" },
};

const key = process.argv[2];
const m = MODELS[key];
if (!m) {
  console.error("Unknown model. Use: " + Object.keys(MODELS).join(", "));
  process.exit(1);
}

const dir = path.join(__dirname, "photos");
const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
const items = {};
for (const f of files) {
  const r = f.match(/^(\d+)_(a|b|sosie)\./i);
  if (r) (items[r[1]] ??= {})[r[2].toLowerCase()] = path.join(dir, f);
}
const ids = Object.keys(items)
  .filter((i) => items[i].a && items[i].b && items[i].sosie)
  .sort();
if (ids.length < 3) {
  console.error(
    "Need at least 3 complete objects (NN_a, NN_b, NN_sosie) in ./photos. Complete objects found: " +
      ids.length,
  );
  for (const id of Object.keys(items).sort()) {
    const miss = ["a", "b", "sosie"].filter((k) => !items[id][k]);
    if (miss.length)
      console.error(
        "  object " +
          id +
          ": missing " +
          miss.map((k) => id + "_" + k + ".png").join(", "),
      );
  }
  process.exit(1);
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const normalize = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

(async () => {
  const tf = await import("@xenova/transformers");
  const { AutoProcessor, RawImage } = tf;

  const t0 = Date.now();
  const processor = await AutoProcessor.from_pretrained(m.id);
  let model;
  if (m.kind === "clip")
    model = await tf.CLIPVisionModelWithProjection.from_pretrained(m.id);
  else if (m.kind === "siglip")
    model = await tf.SiglipVisionModel.from_pretrained(m.id);
  else model = await tf.AutoModel.from_pretrained(m.id);
  const loadMs = Date.now() - t0;

  async function embed(file) {
    const image = await RawImage.read(file);
    const inputs = await processor(image);
    const out = await model(inputs);
    const t = out.image_embeds ?? out.pooler_output;
    if (t) return normalize(Array.from(t.data));
    const h = out.last_hidden_state; // DINOv2: use the CLS token (first token)
    return normalize(Array.from(h.data.slice(0, h.dims[2])));
  }

  const paths = [];
  ids.forEach((i) => paths.push(items[i].a, items[i].b, items[i].sosie));

  await embed(paths[0]); // warm-up
  const runs = [];
  let vecs;
  for (let r = 0; r < 3; r++) {
    const t1 = Date.now();
    vecs = [];
    for (const p of paths) vecs.push(await embed(p));
    runs.push((Date.now() - t1) / paths.length);
  }

  const n = ids.length;
  const A = [],
    B = [],
    S = [];
  ids.forEach((_, k) => {
    A.push(vecs[3 * k]);
    B.push(vecs[3 * k + 1]);
    S.push(vecs[3 * k + 2]);
  });
  const pool = [...B, ...S]; // true second photos + look-alikes compete together

  let top1 = 0,
    top3 = 0,
    mrr = 0,
    beats = 0;
  const trueS = [],
    negS = [];
  A.forEach((a, i) => {
    const ranked = pool
      .map((v, j) => ({ j, s: dot(a, v) }))
      .sort((x, y) => y.s - x.s);
    const rank = ranked.findIndex((r) => r.j === i) + 1;
    if (rank === 1) top1++;
    if (rank <= 3) top3++;
    mrr += 1 / rank;
    const st = dot(a, B[i]),
      sn = dot(a, S[i]);
    trueS.push(st);
    negS.push(sn);
    if (st > sn) beats++;
  });

  const res = {
    key,
    model: m.id,
    n,
    top1: +((top1 / n) * 100).toFixed(1),
    top3: +((top3 / n) * 100).toFixed(1),
    mrr: +(mrr / n).toFixed(3),
    separation: +(mean(trueS) - mean(negS)).toFixed(3),
    hardNegPct: +((beats / n) * 100).toFixed(0),
    loadMs,
    msPerImage: +median(runs).toFixed(1),
    ramMB: Math.round(process.memoryUsage().rss / 1048576),
  };
  fs.mkdirSync(path.join(__dirname, "results"), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, "results", `${key}.json`),
    JSON.stringify(res, null, 2),
  );
  console.log(JSON.stringify(res));
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
