import express from 'express';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}