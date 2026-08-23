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

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class LynkApi {
  constructor({ baseUrl, fetch = globalThis.fetch.bind(globalThis) }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = fetch;
  }

  async getTransferMetadata(transferId) {
    return this.request(`${this.baseUrl}/api/v1/transfers/${encodeURIComponent(transferId)}`);
  }

  async getDownloadUrls(transferId) {
    const json = await this.request(
      `${this.baseUrl}/api/v1/transfers/${encodeURIComponent(transferId)}/downloads`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_ids: null }) },
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
    throw new ApiError(response.status, detail);
  }
}
