// Точное переиспользование пользовательского изображения: только уменьшение размеров.
// Требуется FFmpeg в PATH. Исходник и готовые PNG/ICO хранятся в src/assets.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('../src/assets/', import.meta.url));
const source = path.join(assets, 'icon-source.png');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const temp = mkdtempSync(path.join(os.tmpdir(), 'match-center-icon-'));
const temporaryFiles = [];
const resize = (size, out) => execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
  '-vf', `scale=${size}:${size}:flags=lanczos,format=rgba`, '-frames:v', '1', out,
]);

try {
  resize(512, path.join(assets, 'icon.png'));
  const images = sizes.map((size) => {
    const file = path.join(temp, `${size}.png`);
    temporaryFiles.push(file);
    resize(size, file);
    return readFileSync(file);
  });
  // Windows 10/11 поддерживают PNG внутри ICO для всех этих размеров.
  const directory = Buffer.alloc(6 + 16 * images.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((bytes, i) => {
    const at = 6 + 16 * i;
    directory[at] = directory[at + 1] = sizes[i] === 256 ? 0 : sizes[i];
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(bytes.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([directory, ...images]));
  console.log(`PNG 512×512; ICO ${sizes.join(', ')} px`);
} finally {
  for (const file of temporaryFiles) {
    try { unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  rmdirSync(temp);
}
