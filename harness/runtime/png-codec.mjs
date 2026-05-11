import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function makeCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buffers) {
  let crc = 0xffffffff;

  for (const buffer of buffers) {
    for (const byte of buffer) {
      crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([typeBuffer, data]), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function paethPredictor(left, up, upLeft) {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  if (upDistance <= upLeftDistance) {
    return up;
  }
  return upLeft;
}

export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLength = width * 4;
  const raw = Buffer.alloc(height * (rowLength + 1));

  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (rowLength + 1);
    raw[rawOffset] = 0;
    data.copy(raw, rawOffset + 1, row * rowLength, (row + 1) * rowLength);
  }

  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND")
  ]);
}

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG file");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idatParts = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    offset += 4;
    const data = buffer.subarray(offset, offset + length);
    offset += length;
    offset += 4;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error("Only 8-bit RGB or RGBA PNG files are supported");
  }

  const inflated = zlib.inflateSync(Buffer.concat(idatParts));
  const inputBytesPerPixel = colorType === 6 ? 4 : 3;
  const rowLength = width * inputBytesPerPixel;
  const unfiltered = Buffer.alloc(width * height * inputBytesPerPixel);
  const data = Buffer.alloc(width * height * 4);

  for (let row = 0; row < height; row += 1) {
    const inputOffset = row * (rowLength + 1);
    const filterType = inflated[inputOffset];
    const rowStart = inputOffset + 1;

    for (let column = 0; column < rowLength; column += 1) {
      const current = inflated[rowStart + column];
      const left = column >= inputBytesPerPixel ? unfiltered[row * rowLength + column - inputBytesPerPixel] : 0;
      const up = row > 0 ? unfiltered[(row - 1) * rowLength + column] : 0;
      const upLeft = row > 0 && column >= inputBytesPerPixel
        ? unfiltered[(row - 1) * rowLength + column - inputBytesPerPixel]
        : 0;

      let value = current;
      if (filterType === 1) {
        value = (current + left) & 0xff;
      } else if (filterType === 2) {
        value = (current + up) & 0xff;
      } else if (filterType === 3) {
        value = (current + Math.floor((left + up) / 2)) & 0xff;
      } else if (filterType === 4) {
        value = (current + paethPredictor(left, up, upLeft)) & 0xff;
      }

      unfiltered[row * rowLength + column] = value;
    }
  }

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const inputOffset = pixelIndex * inputBytesPerPixel;
    const outputOffset = pixelIndex * 4;
    data[outputOffset] = unfiltered[inputOffset];
    data[outputOffset + 1] = unfiltered[inputOffset + 1];
    data[outputOffset + 2] = unfiltered[inputOffset + 2];
    data[outputOffset + 3] = colorType === 6 ? unfiltered[inputOffset + 3] : 255;
  }

  return {
    width,
    height,
    data
  };
}
