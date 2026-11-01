import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
// Decode actual PDF streams and embedded font text in an isolated native process.
export async function inspectPdf(
  bytes: Uint8Array,
  raster = false,
): Promise<{
  text: string;
  texts: string[];
  pageSizes: { width: number; height: number }[];
  pageCount: number;
  positions: {
    text: string;
    page: number;
    x: number;
    y: number;
    size: number;
  }[];
  coloredPixels?: number;
}> {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [resolve(__dirname, 'pdf-inspect.cjs'), ...(raster ? ['--raster'] : [])],
      {
        input: bytes,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: 30000,
        windowsHide: true,
      },
    ),
  );
}
