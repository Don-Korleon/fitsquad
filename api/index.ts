import app from "../dist/vercel-app.js";

export default function handler(req: unknown, res: unknown): unknown {
  return (app as (req: unknown, res: unknown) => unknown)(req, res);
}
