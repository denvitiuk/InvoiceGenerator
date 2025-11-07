// web/api/index.ts – Vercel serverless entry for the web app
// This mounts the existing Express app so all routes like /preview, /render, etc. work via /api/index/*

import { createApp } from '../../server/api/index.js';

const app = createApp();

export default function handler(req: any, res: any) {
  // Express app is a compatible (req, res) handler
  return app(req, res);
}
