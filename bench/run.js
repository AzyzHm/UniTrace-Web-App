// Usage: node run.js <model-key>      (one process per model = clean RAM)
const fs = require('fs');
const pairs = require('./pairs.json');

const MODELS = {
  'e5-small':  { id: 'Xenova/multilingual-e5-small', q: 'query: ', p: 'passage: ' },
  'minilm-ml': { id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', q: '', p: '' },
  'e5-base':   { id: 'Xenova/multilingual-e5-base', q: 'query: ', p: 'passage: ' },
  'labse':     { id: 'Xenova/LaBSE', q: '', p: '' },
  'bge-m3':    { id: 'Xenova/bge-m3', q: '', p: '' },
  'minilm-en': { id: 'Xenova/all-MiniLM-L6-v2', q: '', p: '' },
};

const key = process.argv[2];
const m = MODELS[key];
if (!m) { console.error('Unknown model. Use one of: ' + Object.keys(MODELS).join(', ')); process.exit(1); }

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

(async () => {
  const { pipeline } = await import('@xenova/transformers');
  const t0 = Date.now();
  const pipe = await pipeline('feature-extraction', m.id);
  const loadMs = Date.now() - t0;
  const emb = async t => Array.from((await pipe(t, { pooling: 'mean', normalize: true })).data);

  const lostTexts  = pairs.map(p => m.q + p.lost);
  const foundTexts = pairs.map(p => m.p + p.found);
  const negTexts   = pairs.map(p => m.p + p.hardNegative);

  // warm-up, then 3 timed runs over all texts -> median ms/text
  await emb(lostTexts[0]);
  const all = [...lostTexts, ...foundTexts, ...negTexts];
  const runs = [];
  let vecs;
  for (let r = 0; r < 3; r++) {
    const t1 = Date.now();
    vecs = [];
    for (const t of all) vecs.push(await emb(t));
    runs.push((Date.now() - t1) / all.length);
  }
  const n = pairs.length;
  const L = vecs.slice(0, n), F = vecs.slice(n, 2 * n), N = vecs.slice(2 * n);
  const pool = [...F, ...N]; // true founds + hard negatives compete together

  const groups = {};
  let top1 = 0, top3 = 0, mrr = 0, beatsNeg = 0;
  const trueScores = [], negScores = [];

  L.forEach((l, i) => {
    const ranked = pool.map((f, j) => ({ j, s: dot(l, f) })).sort((a, b) => b.s - a.s);
    const rank = ranked.findIndex(r => r.j === i) + 1;
    const g = pairs[i].group;
    groups[g] ??= { n: 0, top1: 0 };
    groups[g].n++;
    if (rank === 1) { top1++; groups[g].top1++; }
    if (rank <= 3) top3++;
    mrr += 1 / rank;
    const st = dot(l, F[i]), sn = dot(l, N[i]);
    trueScores.push(st); negScores.push(sn);
    if (st > sn) beatsNeg++;
  });

  const res = {
    key, model: m.id, n,
    top1: +(top1 / n * 100).toFixed(1),
    top3: +(top3 / n * 100).toFixed(1),
    mrr: +(mrr / n).toFixed(3),
    separation: +(mean(trueScores) - mean(negScores)).toFixed(3),
    loadMs, msPerText: +median(runs).toFixed(1),
    ramMB: Math.round(process.memoryUsage().rss / 1048576),
    byGroup: Object.fromEntries(Object.entries(groups).map(([g, v]) => [g, +(v.top1 / v.n * 100).toFixed(0)])),
    hardNegPct: +(beatsNeg / n * 100).toFixed(0),
  };
  fs.mkdirSync('results', { recursive: true });
  fs.writeFileSync(`results/${key}.json`, JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res));
})().catch(e => { console.error(e.message); process.exit(1); });
