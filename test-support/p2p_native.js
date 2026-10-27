export const KEY = "0123456789abcdef0123456789abcdef";
export const flush = () => new Promise(setImmediate);
export async function until(ready) {
  const deadline = Date.now() + 2000;
  while (!ready()) {
    if (Date.now() >= deadline) throw new Error("native-boundary test did not reach its next stage");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
export function barrier() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

export function nativeBoundary(t) {
  let socket, peer, channel;
  function replace(name, value) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
  replace("WebSocket", class {
    static OPEN = 1;
    readyState = 1;
    constructor() { socket = this; }
    send() {}
    close() { this.readyState = 3; }
  });
  replace("RTCPeerConnection", class {
    constructor() { peer = this; }
    createDataChannel() {
      channel = {
        label: "fileTransfer", bufferedAmount: 0, closed: false, sent: [],
        send(data) {
          this.sent.push(data);
          this.bufferedAmount += typeof data === "string" ? data.length : data.byteLength;
        },
        close() { this.closed = true; },
      };
      return channel;
    }
    async createOffer() { return { type: "offer", sdp: "test-offer" }; }
    async createAnswer() { return { type: "answer", sdp: "test-answer" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() {}
  });
  return {
    async openSender(hello = { t: "hi", v: 2, receipts: true }) {
      socket.onopen();
      await flush();
      channel.onopen();
      if (hello) channel.onmessage({ data: JSON.stringify(hello) });
      return channel;
    },
    async openReceiver() {
      socket.onopen();
      socket.onmessage({ data: JSON.stringify({ type: "offer", sdp: "test-offer" }) });
      await flush();
      channel = { label: "fileTransfer", sent: [], send(data) { this.sent.push(data); } };
      peer.ondatachannel({ channel });
      channel.onopen();
      return channel;
    },
  };
}
