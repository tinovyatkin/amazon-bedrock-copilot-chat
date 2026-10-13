export interface ImageDimensions {
  readonly height: number;
  readonly width: number;
}

export function getImageDimensions(
  data: Uint8Array,
  mimeType: string,
): ImageDimensions | undefined {
  switch (mimeType) {
    case "image/gif": {
      return readGifDimensions(data);
    }
    case "image/jpeg": {
      return readJpegDimensions(data);
    }
    case "image/png": {
      return readPngDimensions(data);
    }
    case "image/webp": {
      return readWebpDimensions(data);
    }
    default: {
      return undefined;
    }
  }
}

function isJpegStartOfFrameMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readGifDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 10 || data[0] !== 0x47 || data[1] !== 0x49 || data[2] !== 0x46) {
    return undefined;
  }
  return {
    height: data[8] | (data[9] << 8),
    width: data[6] | (data[7] << 8),
  };
}

function readJpegDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return undefined;
  }

  for (let offset = 2; offset + 8 < data.length; ) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = data[offset + 1];
    const segmentLength = (data[offset + 2] << 8) | data[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > data.length) {
      return undefined;
    }
    if (isJpegStartOfFrameMarker(marker)) {
      return {
        height: (data[offset + 5] << 8) | data[offset + 6],
        width: (data[offset + 7] << 8) | data[offset + 8],
      };
    }
    offset += 2 + segmentLength;
  }

  return undefined;
}

function readPngDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (
    data.length < 24 ||
    data[0] !== 0x89 ||
    data[1] !== 0x50 ||
    data[2] !== 0x4e ||
    data[3] !== 0x47
  ) {
    return undefined;
  }
  return { height: readUint32BigEndian(data, 20), width: readUint32BigEndian(data, 16) };
}

function readUint32BigEndian(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  );
}

function readWebpDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 30 || data[0] !== 0x52 || data[8] !== 0x57 || data[9] !== 0x45) {
    return undefined;
  }

  if (data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x58) {
    return {
      height: 1 + data[27] + (data[28] << 8) + (data[29] << 16),
      width: 1 + data[24] + (data[25] << 8) + (data[26] << 16),
    };
  }

  if (data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x4c) {
    if (data[20] !== 0x2f) {
      return undefined;
    }
    return {
      height: 1 + ((data[22] >> 6) | (data[23] << 2) | ((data[24] & 0x0f) << 10)),
      width: 1 + (data[21] | ((data[22] & 0x3f) << 8)),
    };
  }

  if (
    data[12] === 0x56 &&
    data[13] === 0x50 &&
    data[14] === 0x38 &&
    data[15] === 0x20 &&
    data[23] === 0x9d &&
    data[24] === 0x01 &&
    data[25] === 0x2a
  ) {
    return {
      height: (data[28] | (data[29] << 8)) & 16_383,
      width: (data[26] | (data[27] << 8)) & 16_383,
    };
  }

  return undefined;
}
