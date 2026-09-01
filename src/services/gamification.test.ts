import { describe, expect, it } from "vitest";
import { detectImageFormat, verifyWorkoutPhoto } from "./gamification.js";

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
  Buffer.from([0]), // detectImageFormat requires length > 12 to safely read bytes 8-11
]);

function padTo(buffer: Buffer, size: number): Buffer {
  return Buffer.concat([buffer, Buffer.alloc(Math.max(0, size - buffer.length))]);
}

describe("detectImageFormat", () => {
  it("recognizes a real JPEG header", () => {
    expect(detectImageFormat(JPEG_HEADER)).toBe("jpeg");
  });

  it("recognizes a real PNG header", () => {
    expect(detectImageFormat(PNG_HEADER)).toBe("png");
  });

  it("recognizes a real WEBP (RIFF) header", () => {
    expect(detectImageFormat(WEBP_HEADER)).toBe("webp");
  });

  it("rejects a plain text/blob buffer padded to a large size", () => {
    // This is the exact bypass the check exists to close: an arbitrary blob padded past any
    // size threshold, with a spoofed image/* Content-Type on the upload request.
    const fakeImage = padTo(Buffer.from("definitely not a photo"), 50_000);
    expect(detectImageFormat(fakeImage)).toBeNull();
  });

  it("rejects an empty buffer", () => {
    expect(detectImageFormat(Buffer.alloc(0))).toBeNull();
  });
});

describe("verifyWorkoutPhoto (pre-AI validation paths)", () => {
  it("rejects an empty buffer", async () => {
    const result = await verifyWorkoutPhoto(Buffer.alloc(0), undefined);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/не найден/i);
  });

  it("rejects a buffer that isn't a real image regardless of size", async () => {
    const fakeImage = padTo(Buffer.from("spoofed image/* upload"), 50_000);
    const result = await verifyWorkoutPhoto(fakeImage, undefined);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/не похож/i);
  });

  it("rejects a real but undersized image", async () => {
    const tinyJpeg = padTo(JPEG_HEADER, 500);
    const result = await verifyWorkoutPhoto(tinyJpeg, undefined);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/маленькое/i);
  });
});
