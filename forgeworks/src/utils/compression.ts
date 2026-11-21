// Pure TypeScript LZ77 sliding-window + Base64 compressor for zero-dependency factory export/import
export function compressString(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const out: number[] = [];
  let pos = 0;

  while (pos < bytes.length) {
    let bestLen = 0;
    let bestDist = 0;
    const windowStart = Math.max(0, pos - 255);
    const maxLen = Math.min(255, bytes.length - pos);

    for (let j = windowStart; j < pos; j++) {
      let len = 0;
      while (len < maxLen && bytes[j + len] === bytes[pos + len]) {
        len++;
      }
      if (len > bestLen && len >= 4) {
        bestLen = len;
        bestDist = pos - j;
      }
    }

    if (bestLen >= 4) {
      out.push(0xff, bestDist, bestLen);
      pos += bestLen;
    } else {
      if (bytes[pos] === 0xff) {
        out.push(0xff, 0, 1);
      } else {
        out.push(bytes[pos]);
      }
      pos++;
    }
  }

  const packed = new Uint8Array(out);
  let str = '';
  for (let i = 0; i < packed.length; i++) {
    str += String.fromCharCode(packed[i]);
  }
  return 'FW1:' + btoa(str);
}

export function decompressString(encoded: string): string {
  const trimmed = encoded.trim();
  if (!trimmed.startsWith('FW1:')) {
    return trimmed;
  }
  const bin = atob(trimmed.slice(4));
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    raw[i] = bin.charCodeAt(i);
  }
  const out: number[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === 0xff) {
      const dist = raw[i + 1];
      const len = raw[i + 2];
      i += 3;
      if (dist === 0 && len === 1) {
        out.push(0xff);
      } else {
        const start = out.length - dist;
        for (let k = 0; k < len; k++) {
          out.push(out[start + k]);
        }
      }
    } else {
      out.push(raw[i]);
      i++;
    }
  }
  return new TextDecoder().decode(new Uint8Array(out));
}
