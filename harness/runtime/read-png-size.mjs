import fs from "node:fs/promises";

const PNG_SIGNATURE = "89504e470d0a1a0a";

export async function readPngSize(filePath) {
  const handle = await fs.open(filePath, "r");

  try {
    const buffer = Buffer.alloc(24);
    await handle.read(buffer, 0, buffer.length, 0);

    const signature = buffer.subarray(0, 8).toString("hex");
    if (signature !== PNG_SIGNATURE) {
      throw new Error(`Not a PNG file: ${filePath}`);
    }

    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  } finally {
    await handle.close();
  }
}
