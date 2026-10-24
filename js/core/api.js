export class TransferNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransferNotFoundError";
  }
}

export class NetworkError extends Error {
  constructor(cause) {
    super(`network request failed: ${cause?.message ?? cause}`);
    this.name = "NetworkError";
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class LimitExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = "LimitExceededError";
  }
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function capabilityHeaders(name, value) {
  if (!value) return {};
  return { [name]: value };
}

export class LynkApi {
  constructor({ baseUrl, fetch = globalThis.fetch.bind(globalThis) }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = fetch;
  }

  async getTransferMetadata(transferId, accessToken) {
    return this.request(`${this.baseUrl}/api/v1/transfers/${encodeURIComponent(transferId)}`, {
      headers: capabilityHeaders("X-Lynk-Access-Token", accessToken),
    });
  }

  async createTransfer(files) {
    const json = await this.request(`${this.baseUrl}/api/v1/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: files.map((f) => ({
          file_name: f.name,
          file_size: f.size,
          content_type: f.type || "application/octet-stream",
        })),
      }),
    });
    return {
      transferId: json.transfer_id,
      status: json.status,
      expiresIn: json.expires_in,
      senderSecret: json.sender_secret,
      accessToken: json.access_token,
      files: (json.files ?? []).map((f) => ({
        fileId: f.file_id,
        fileName: f.file_name,
        fileSize: f.file_size,
        uploadUrl: f.upload_url,
      })),
    };
  }

  async completeFile(transferId, fileId, senderSecret) {
    return this.request(
      `${this.baseUrl}/api/v1/transfers/${encodeURIComponent(transferId)}/files/${encodeURIComponent(fileId)}/complete`,
      { method: "POST", headers: capabilityHeaders("X-Lynk-Sender-Secret", senderSecret) },
    );
  }

  async extendTransfer(transferId, senderSecret) {
    const json = await this.request(
      `${this.baseUrl}/api/v1/transfers/${encodeURIComponent(transferId)}/extend`,
      { method: "POST", headers: capabilityHeaders("X-Lynk-Sender-Secret", senderSecret) },
    );
    return { transferId: json.transfer_id, status: json.status, expiresIn: json.expires_in };
  }

  async createReceiverSession() {
    const json = await this.request(`${this.baseUrl}/api/v1/receiver-sessions`, {
      method: "POST",
    });
    return { sessionId: json.session_id, status: json.status, expiresIn: json.expires_in };
  }

  async getReceiverSession(sessionId) {
    const json = await this.request(
      `${this.baseUrl}/api/v1/receiver-sessions/${encodeURIComponent(sessionId)}`,
    );
    return {
      sessionId: json.session_id,
      status: json.status,
      transferId: json.transfer_id ?? null,
      wrappedKey: json.wrapped_key ?? null,
      expiresIn: json.expires_in ?? 0,
    };
  }

  async joinSenderSession(code, receiverPk) {
    const json = await this.request(`${this.baseUrl}/api/v1/sender-sessions/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, receiver_pk: receiverPk }),
    });
    return {
      sessionId: json.session_id,
      status: json.status,
      expiresIn: json.expires_in ?? 0,
    };
  }

  /**
   * The sender's wrapped key, or null while the sender has not attached it.
   * A 409 is the normal "not yet" answer, not a failure.
   */
  async getSenderSessionKey(sessionId) {
    try {
      const json = await this.request(
        `${this.baseUrl}/api/v1/sender-sessions/${encodeURIComponent(sessionId)}/key`,
      );
      return {
        transferId: json.transfer_id,
        wrappedKey: json.wrapped_key,
        mode: json.mode ?? "cloud",
      };
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return null;
      throw err;
    }
  }

  async createSenderSession() {
    const json = await this.request(`${this.baseUrl}/api/v1/sender-sessions`, {
      method: "POST",
    });
    return {
      sessionId: json.session_id,
      code: json.code,
      expiresIn: json.expires_in ?? 0,
    };
  }

  async getSenderSession(sessionId) {
    const json = await this.request(
      `${this.baseUrl}/api/v1/sender-sessions/${encodeURIComponent(sessionId)}`,
    );
    return {
      sessionId: json.session_id,
      status: json.status,
      receiverPk: json.receiver_pk ?? null,
      expiresIn: json.expires_in ?? 0,
    };
  }

  async attachSenderKey(sessionId, transferId, wrappedKey, mode) {
    return this.request(
      `${this.baseUrl}/api/v1/sender-sessions/${encodeURIComponent(sessionId)}/attach`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transfer_id: transferId,
          wrapped_key: wrappedKey,
          mode,
        }),
      },
    );
  }

  async attachTransfer(sessionId, transferId, wrappedKey) {    return this.request(
      `${this.baseUrl}/api/v1/receiver-sessions/${encodeURIComponent(sessionId)}/attach-transfer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transfer_id: transferId, wrapped_key: wrappedKey }),
      },
    );
  }

  async getDownloadUrls(transferId, accessToken) {
    const json = await this.request(
      `${this.baseUrl}/api/v1/transfers/${encodeURIComponent(transferId)}/downloads`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...capabilityHeaders("X-Lynk-Access-Token", accessToken),
        },
        body: JSON.stringify({ file_ids: null }),
      },
    );
    return (json?.files ?? []).map((f) => ({
      fileId: f.file_id,
      fileName: f.file_name,
      downloadUrl: f.download_url,
      expiresIn: f.expires_in,
    }));
  }

  async request(url, options) {
    let response;
    try {
      response = await this.fetch(url, options);
    } catch (cause) {
      throw new NetworkError(cause);
    }

    if (response.ok) return parseJson(response);

    const json = await parseJson(response);
    const detail = typeof json?.detail === "string" ? json.detail : `request failed (${response.status})`;
    if (response.status === 404) throw new TransferNotFoundError(detail);
    if (response.status === 413) throw new LimitExceededError(detail);
    throw new ApiError(response.status, detail);
  }
}
