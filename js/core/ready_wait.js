/**
 * Waiting for a sender that has not uploaded its files yet.
 *
 * A sender shows its QR code before it uploads anything, and it waits for a
 * direct connection first. A receiver that gives up on the direct connection
 * and asks for the files straight away is told by the server that the
 * transfer is not ready yet. That is a temporary state, not a broken link, so
 * the receiver waits for the sender instead of reporting a failure.
 */

/** The status the server answers with while the sender is still working. */
export const TRANSFER_NOT_READY_STATUS = 409;

/** How long a receiver waits for the sender before giving up. */
export const DEFAULT_READY_TIMEOUT_MS = 120_000;

/** How often a receiver asks the server whether the sender is done. */
export const DEFAULT_READY_POLL_INTERVAL_MS = 3_000;

/** Raised when the sender never finishes uploading in time. */
export class TransferStillUploadingError extends Error {
  constructor(
    message = "The sender is still uploading. Wait a moment and try again.",
  ) {
    super(message);
    this.name = "TransferStillUploadingError";
    this.status = TRANSFER_NOT_READY_STATUS;
  }
}

/**
 * True when the server refused the request because the sender is not done
 * yet.
 */
export function isNotReadyError(error) {
  return Boolean(error) && error.status === TRANSFER_NOT_READY_STATUS;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the server until the sender has uploaded its files.
 *
 * Returns the transfer metadata once the status is `ready`. Throws when the
 * transfer disappears, and when the sender has still not finished by the time
 * the timeout runs out.
 */
export async function waitForTransferReady({
  api,
  transferId,
  accessToken,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_READY_POLL_INTERVAL_MS,
  onWait = () => {},
  sleep = defaultSleep,
  // Timeout budgets must not move when the system clock is corrected.
  now = () => performance.now(),
}) {
  const deadline = now() + timeoutMs;

  for (;;) {
    const metadata = await api.getTransferMetadata(transferId, accessToken);
    if (metadata?.status === "ready") {
      return metadata;
    }

    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new TransferStillUploadingError();
    }

    onWait({ status: metadata?.status ?? "unknown", remainingMs: remaining });
    await sleep(Math.min(pollIntervalMs, remaining));
  }
}
