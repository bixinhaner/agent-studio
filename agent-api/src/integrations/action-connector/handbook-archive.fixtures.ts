// Test fixtures only: builds a minimal ustar+gzip handbook archive.
import { gzipSync } from "node:zlib";

function tarOctal(value: number, length: number): Buffer {
  return Buffer.from(value.toString(8).padStart(length - 1, "0") + "\0", "ascii");
}

export function tarArchive(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    const body = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    tarOctal(0o644, 8).copy(header, 100);
    tarOctal(0, 8).copy(header, 108);
    tarOctal(0, 8).copy(header, 116);
    tarOctal(body.length, 12).copy(header, 124);
    tarOctal(0, 12).copy(header, 136);
    header.fill(32, 148, 156);
    header[156] = "0".charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    tarOctal([...header].reduce((total, value) => total + value, 0), 8).copy(header, 148);
    blocks.push(header, body, Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
