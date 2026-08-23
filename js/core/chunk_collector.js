export class ChunkCollector {
  #chunks = [];
  #receivedBytes = 0;
  #chunkCount = 0;
  #closed = false;

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
    this.#chunks.push(chunk);
    this.#receivedBytes += chunk.length;
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
