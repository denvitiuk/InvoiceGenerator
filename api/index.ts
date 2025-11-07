// api/index.ts – Vercel serverless entry that mounts our Express app
import { createApp } from '../server/api/index.js';

const app = createApp();

export default function handler(req: any, res: any) {
  // Express app is a compatible handle (req, res)
  return app(req, res);
}