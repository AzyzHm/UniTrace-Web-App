import { createApp } from '../src/app.js';

const port = process.env.PORT ?? 3000;
const app = createApp();

app.listen(port, () => {
  console.log(`UniTrace API listening on port ${port}`);
});