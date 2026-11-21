const fs = require('fs'), path = require('path');
const order = ['clip-b32', 'clip-b16', 'siglip', 'dino-s', 'dino-b'];
const rows = order.map(k => { const f = path.join(__dirname, 'results', k + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : null; }).filter(Boolean);
console.log('\nPhoto models - results');
console.log('Model | Top-1 | Top-3 | MRR | Separation | Hard negatives | Load (ms) | ms/image | RAM (MB)');
rows.forEach(r => console.log([r.model.replace('Xenova/', ''), r.top1 + '%', r.top3 + '%', r.mrr, r.separation, r.hardNegPct + '%', r.loadMs, r.msPerImage, r.ramMB].join(' | ')));
