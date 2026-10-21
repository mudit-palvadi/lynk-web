// The handshake budget. A phone that opens the app from a QR code is
// cold-starting, so eight seconds is not enough for it to answer the offer
// and trade connection candidates over a mobile network.
const DEFAULT_TIMEOUT_MS = 30000;

export class P2pCoordinator {
  #actions;
  #timeoutMs;
  #onP2PFailed;
  #timer = null;
  #connected = false;
  #failed = false;
  #disposed = false;

  constructor({ actions, timeoutMs = DEFAULT_TIMEOUT_MS, onP2PFailed }) {
    this.#actions = actions;
    this.#timeoutMs = timeoutMs;
    this.#onP2PFailed = onP2PFailed;
  }

  async start({ role }) {
    if (this.#disposed) return;
    this.#timer = setTimeout(() => this.#onTimeout(), this.#timeoutMs);
    if (role === "sender") {
      const offer = await this.#actions.createOffer();
      await this.#actions.sendSignaling(offer);
    }
  }

  async handleMessage(message) {
    if (this.#disposed) return;

    switch (message.type) {
      case "offer":
      case "answer": {
        const answer = await this.#actions.handleRemoteDescription(message);
        if (answer && !this.#disposed) {
          await this.#actions.sendSignaling(answer);
        }
        break;
      }
      case "candidate":
        if (message.candidate) {
          await this.#actions.addIceCandidate(message.candidate);
        }
        break;
      default:
        break;
    }
  }

  notifyConnected() {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (!this.#disposed && !this.#failed) {
      this.#connected = true;
    }
  }

  get hasFailed() {
    return this.#failed;
  }

  dispose() {
    this.#disposed = true;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #onTimeout() {
    this.#timer = null;
    if (this.#disposed || this.#connected || this.#failed) return;
    this.#failed = true;
    this.#onP2PFailed?.();
  }
}
