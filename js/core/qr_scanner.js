export function isScannerSupported() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof document !== "undefined" &&
    typeof window.qrcode !== "undefined" ||
    typeof globalThis.jsQR === "function"
  );
}

export async function scanReceiverQr(video, { onCancel }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
  });
  video.srcObject = stream;
  await video.play();

  let cancelled = false;
  const cleanup = () => {
    cancelled = true;
    for (const track of stream.getTracks()) track.stop();
  };
  onCancel?.(cleanup);

  const detector =
    typeof window.BarcodeDetector === "function"
      ? new window.BarcodeDetector({ formats: ["qr_code"] })
      : null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const decodeFrame = async () => {
    if (video.videoWidth === 0) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    if (detector) {
      const hits = await detector.detect(canvas);
      return hits.length > 0 ? hits[0].rawValue : null;
    }
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hit = globalThis.jsQR(image.data, image.width, image.height);
    return hit?.data ?? null;
  };

  return new Promise((resolve) => {
    const tick = async () => {
      if (cancelled) {
        resolve(null);
        return;
      }
      try {
        const raw = await decodeFrame();
        if (raw && raw.includes("/receive/")) {
          cleanup();
          resolve(raw);
          return;
        }
      } catch {}
      requestAnimationFrame(() => tick());
    };
    tick();
  });
}
