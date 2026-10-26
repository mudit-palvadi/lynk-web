/** Same-origin receiver coordination, not authentication or a server lease. */
export async function acquireReceiverOwnership({ apiBase, transferId, locks } = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const decide = (result) => {
      if (decided) return;
      decided = true;
      resolve(result);
    };
    try {
      const manager = locks ?? globalThis.navigator?.locks;
      if (!manager?.request || typeof transferId !== "string" || !transferId) {
        decide({ status: "unavailable" });
        return;
      }
      // Signaling rooms are scoped to the API origin. Never use credentials
      // in the lock name: browsers expose held lock names to same-origin code.
      const origin = new URL(apiBase).origin;
      const name = `lynkshare:p2p:receiver:${origin}:${encodeURIComponent(transferId)}`;
      let unlock;
      const lifetime = new Promise((done) => { unlock = done; });
      let releasing;
      const request = Promise.resolve(manager.request(name, { mode: "exclusive", ifAvailable: true }, (lock) => {
        if (!lock) {
          decide({ status: "busy" });
          return;
        }
        decide({
          status: "acquired",
          release() {
            // Do not report release until the browser's request has finished.
            if (!releasing) {
              unlock();
              releasing = request.then(() => {}, () => {});
            }
            return releasing;
          },
        });
        return lifetime;
      }));
      request.catch(() => decide({ status: "unavailable" }));
    } catch {
      // Private contexts/policy can deny access even when the API exists.
      decide({ status: "unavailable" });
    }
  });
}
