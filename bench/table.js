// Prints the two tables of section 7, ready to copy into the Word file.
const fs = require('fs');
const order = ['e5-small', 'minilm-ml', 'e5-base', 'labse', 'bge-m3', 'minilm-en'];
const rows = order.map(k => fs.existsSync(`results/${k}.json`) ? JSON.parse(fs.readFileSync(`results/${k}.json`)) : null).filter(Boolean);
const name = r => r.model.replace('Xenova/', '');
console.log('\nTable 1 - global results');
console.log('Model | Top-1 | Top-3 | MRR | Separation | Load (ms) | ms/text | RAM (MB)');
rows.forEach(r => console.log([name(r), r.top1 + '%', r.top3 + '%', r.mrr, r.separation, r.loadMs, r.msPerText, r.ramMB].join(' | ')));
console.log('\nTable 2 - Top-1 by type of pair');
console.log('Model | EN-EN | FR-FR | AR-AR | Cross-language | Hard negatives');
rows.forEach(r => console.log([name(r), r.byGroup.en + '%', r.byGroup.fr + '%', r.byGroup.ar + '%', r.byGroup.cross + '%', r.hardNegPct + '%'].join(' | ')));
