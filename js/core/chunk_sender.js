import { BackpressureController } from "./backpressure.js";

export const CHUNK_SIZE = 64 * 1024;

function chunkOffsets(totalLength, chunkSize) {
  const offsets = [];
  let start = 0;
  while (start < totalLength) {
    const end = Math.min(start + chunkSize, totalLength);
    offsets.push([start, end]);
    start = end;
  }
  return offsets;
}

export class ChunkSender {
  #bufferedAmount;
  #send;
  #pollIntervalMs;
  #backpressure = new BackpressureController();
  pauses = 0;

  constructor({ bufferedAmount, send, pollIntervalMs = 10 }) {
    this.#bufferedAmount = bufferedAmount;
    this.#send = send;
    this.#pollIntervalMs = pollIntervalMs;
  }

  async sendAll(payload) {
    if (!payload || payload.length === 0) return;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (const [start, end] of chunkOffsets(payload.length, CHUNK_SIZE)) {
      while (!this.#backpressure.canSend(this.#bufferedAmount())) {
        this.pauses += 1;
        await sleep(this.#pollIntervalMs);
      }
      await this.#send(payload.subarray(start, end));
    }
  }
}
