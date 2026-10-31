const m_ = {
  'clip-b32': { id: 'Xenova/clip-vit-base-patch32',   kind: 'clip' },
  'clip-b16': { id: 'Xenova/clip-vit-base-patch16',   kind: 'clip' },
  'siglip':   { id: 'Xenova/siglip-base-patch16-224', kind: 'siglip' },
  'dino-s':   { id: 'Xenova/dinov2-small',            kind: 'dino' },
  'dino-b':   { id: 'Xenova/dinov2-base',             kind: 'dino' },
};
const [key, a, b, other] = process.argv.slice(2);
const m = m_[key];
if (!m || !a || !b) { console.error('Usage: node compare.js <model> <photoA> <photoB> [photoOther]'); process.exit(1); }

const dot = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };

(async () => {
  const tf = await import('@xenova/transformers');
  const processor = await tf.AutoProcessor.from_pretrained(m.id);
  const model = m.kind === 'clip' ? await tf.CLIPVisionModelWithProjection.from_pretrained(m.id)
              : m.kind === 'siglip' ? await tf.SiglipVisionModel.from_pretrained(m.id)
              : await tf.AutoModel.from_pretrained(m.id);
  const embed = async f => {
    const out = await model(await processor(await tf.RawImage.read(f)));
    const t = out.image_embeds ?? out.pooler_output;
    if (t) return norm(Array.from(t.data));
    const h = out.last_hidden_state;
    return norm(Array.from(h.data.slice(0, h.dims[2])));
  };
  const [ea, eb] = [await embed(a), await embed(b)];
  const same = dot(ea, eb);
  let line = `${key.padEnd(9)} A vs B (same object): ${same.toFixed(3)}`;
  if (other) {
    const diff = dot(ea, await embed(other));
    line += `   A vs other: ${diff.toFixed(3)}   gap: ${(same - diff).toFixed(3)}`;
  }
  console.log(line);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });