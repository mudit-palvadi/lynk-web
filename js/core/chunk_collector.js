// The most a peer may send in one file.
//
// The largest device-to-device transfer the app offers is the unlocked
// 50 MB tier, plus a little for the per-file encryption overhead (a 16-byte
// IV and up to 16 bytes of padding for every file).
export const MAX_RECEIVE_BYTES = 50 * 1024 * 1024 + 1024;

export class ChunkCollector {
  #chunks = [];
  #receivedBytes = 0;
  #chunkCount = 0;
  #closed = false;
  #expectedBytes = 0;
  #limitBytes = MAX_RECEIVE_BYTES;

  /**
   * @param {number} expectedBytes what the peer said the file is
   * @param {number} limitBytes the biggest a file may be
   */
  constructor({ expectedBytes = 0, limitBytes = MAX_RECEIVE_BYTES } = {}) {
    this.#expectedBytes = expectedBytes;
    this.#limitBytes = limitBytes;
  }

  get receivedBytes() {
    return this.#receivedBytes;
  }

  get chunkCount() {
    return this.#chunkCount;
  }

  add(chunk) {
    if (this.#closed) {
      throw new Error("ChunkCollector already closed");
    }
    if (!chunk || chunk.length === 0) return;
    // A peer may not send more than it declared, and no file may be larger
    // than the biggest transfer on offer. Without this a peer could fill the
    // browser's memory.
    const total = this.#receivedBytes + chunk.length;
    if (total > this.#limitBytes) {
      throw new Error("the peer sent more data than a transfer may hold");
    }
    if (this.#expectedBytes > 0 && total > this.#expectedBytes) {
      throw new Error("the peer sent more data than it declared");
    }
    this.#chunks.push(chunk);
    this.#receivedBytes = total;
    this.#chunkCount += 1;
  }

  async close() {
    this.#closed = true;
    const out = new Uint8Array(this.#receivedBytes);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.#chunks = [];
    return out;
  }
}
