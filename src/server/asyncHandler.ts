import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not catch rejected promises from async route handlers — an unhandled
 * rejection there crashes the whole Node process (default behavior since Node 15), not just
 * that one request. Wrapping every route in this forwards the error to Express's error
 * middleware instead.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
