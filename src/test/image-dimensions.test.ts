import * as assert from "node:assert";

import { getImageDimensions } from "../image-dimensions";

function pngFixture(width: number, height: number): Uint8Array {
  const data = new Uint8Array(24);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  data.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  data.set(
    [
      (width >>> 24) & 0xff,
      (width >>> 16) & 0xff,
      (width >>> 8) & 0xff,
      width & 0xff,
      (height >>> 24) & 0xff,
      (height >>> 16) & 0xff,
      (height >>> 8) & 0xff,
      height & 0xff,
    ],
    16,
  );
  return data;
}

suite("image dimension parsing", () => {
  test("reads dimensions from PNG IHDR", () => {
    assert.deepEqual(getImageDimensions(pngFixture(1200, 900), "image/png"), {
      height: 900,
      width: 1200,
    });
  });

  test("returns undefined for malformed image data", () => {
    assert.equal(getImageDimensions(new Uint8Array([1, 2, 3]), "image/png"), undefined);
    assert.equal(getImageDimensions(pngFixture(1, 1), "image/unknown"), undefined);
  });
});
