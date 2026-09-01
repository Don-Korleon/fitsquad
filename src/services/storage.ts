import fs from "node:fs";
import path from "node:path";
import { put, del } from "@vercel/blob";
import { config } from "../config.js";

/**
 * Photo storage abstraction. On Vercel, local disk (`/tmp`) is wiped between
 * invocations and not shared across serverless instances — so verification
 * photos must go to durable storage (Vercel Blob) whenever it's configured.
 * Falls back to local disk for environments without a Blob store attached
 * (local dev, VPS/Docker deployments with a real persistent filesystem).
 */
export function isBlobEnabled(): boolean {
  return !!config.blobToken;
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Saves a photo buffer durably and returns the path/URL to persist in the DB. */
export async function savePhotoBuffer(buffer: Buffer, filename: string): Promise<string> {
  if (isBlobEnabled()) {
    const blob = await put(`verify-photos/${filename}`, buffer, {
      access: "public",
      token: config.blobToken,
      addRandomSuffix: true,
    });
    return blob.url;
  }

  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const localPath = path.join(config.uploadsDir, filename);
  fs.writeFileSync(localPath, buffer);
  return localPath;
}

export async function deletePhoto(pathOrUrl: string): Promise<void> {
  if (isUrl(pathOrUrl)) {
    if (isBlobEnabled()) {
      try {
        await del(pathOrUrl, { token: config.blobToken });
      } catch {
        /* already gone */
      }
    }
    return;
  }

  try {
    fs.unlinkSync(pathOrUrl);
  } catch {
    /* already gone */
  }
}
