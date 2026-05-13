/**
 * Simple big-endian byte reader for Yamaha .sty / .sst parsing.
 * Maintains a cursor position and offers Java-DataInputStream-like helpers
 * (readUInt, readUByte, readString, skip, peek4).
 */

export class ByteReader {
  private view: DataView;
  private pos = 0;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      this.view = new DataView(buffer);
    }
  }

  get position(): number { return this.pos; }
  get length(): number { return this.view.byteLength; }
  get remaining(): number { return this.length - this.pos; }

  seek(p: number): void {
    if (p < 0 || p > this.length) throw new RangeError(`seek out of range: ${p}`);
    this.pos = p;
  }

  skip(n: number): void {
    if (this.pos + n > this.length) {
      throw new Error(`skip past end of buffer (pos=${this.pos}, n=${n}, len=${this.length})`);
    }
    this.pos += n;
  }

  readUInt8(): number {
    if (this.pos >= this.length) throw new Error('readUInt8: end of buffer');
    return this.view.getUint8(this.pos++);
  }

  readInt8(): number {
    if (this.pos >= this.length) throw new Error('readInt8: end of buffer');
    return this.view.getInt8(this.pos++);
  }

  readUInt16BE(): number {
    if (this.pos + 2 > this.length) throw new Error('readUInt16BE: end of buffer');
    const v = this.view.getUint16(this.pos, false);
    this.pos += 2;
    return v;
  }

  readUInt32BE(): number {
    if (this.pos + 4 > this.length) throw new Error('readUInt32BE: end of buffer');
    const v = this.view.getUint32(this.pos, false);
    this.pos += 4;
    return v;
  }

  /** Read `n` bytes as ASCII string (no NUL-termination handling). */
  readString(n: number): string {
    if (this.pos + n > this.length) throw new Error(`readString(${n}): end of buffer`);
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.view.getUint8(this.pos + i));
    this.pos += n;
    return s;
  }

  /** Read 4 ASCII bytes WITHOUT advancing the cursor. */
  peek4(): string {
    if (this.pos + 4 > this.length) return '';
    let s = '';
    for (let i = 0; i < 4; i++) s += String.fromCharCode(this.view.getUint8(this.pos + i));
    return s;
  }

  /** Variable-length quantity (MIDI standard). */
  readVLQ(): number {
    let v = 0;
    while (true) {
      const b = this.readUInt8();
      v = (v << 7) | (b & 0x7F);
      if ((b & 0x80) === 0) break;
    }
    return v;
  }

  /** Slice n bytes from current position into a Uint8Array, advancing the cursor. */
  readBytes(n: number): Uint8Array {
    if (this.pos + n > this.length) throw new Error(`readBytes(${n}): end of buffer`);
    const arr = new Uint8Array(
      this.view.buffer,
      this.view.byteOffset + this.pos,
      n,
    ).slice();
    this.pos += n;
    return arr;
  }

  /** Assert the next 4 bytes equal `expected`; throw if not. */
  expectAscii(expected: string): void {
    const actual = this.readString(expected.length);
    if (actual !== expected) {
      throw new Error(
        `expected "${expected}" at pos ${this.pos - expected.length}, got "${actual}"`,
      );
    }
  }
}
