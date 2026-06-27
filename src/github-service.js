/**
 * @fileoverview GitHub API Service Layer
 * Handles all GitHub Contents API interactions.
 * Never caches SHA — always fetches fresh before any update.
 */

// ---------------------------------------------------------------------------
// Custom Error Types
// ---------------------------------------------------------------------------

export class GitHubError extends Error {
  /** @param {string} message @param {string} code @param {number} [status] */
  constructor(message, code, status) {
    super(message);
    this.name = "GitHubError";
    this.code = code;
    this.status = status;
  }
}

export const GH_ERROR_CODES = {
  INVALID_TOKEN:        "INVALID_TOKEN",
  REPO_NOT_FOUND:       "REPO_NOT_FOUND",
  NO_PERMISSION:        "NO_PERMISSION",
  SHA_MISMATCH:         "SHA_MISMATCH",
  RATE_LIMITED:         "RATE_LIMITED",
  NETWORK_FAILURE:      "NETWORK_FAILURE",
  BAD_CONFIG:           "BAD_CONFIG",
  UNKNOWN:              "UNKNOWN",
};

// ---------------------------------------------------------------------------
// GitHubService
// ---------------------------------------------------------------------------

export class GitHubService {
  /**
   * @param {string} token  – GitHub Personal Access Token
   */
  constructor(token) {
    this._token = token;
    this._base  = "https://api.github.com";
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** @returns {Record<string,string>} */
  _headers() {
    return {
      Authorization:  `Bearer ${this._token}`,
      Accept:         "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  /**
   * Map raw HTTP status → GitHubError.
   * @param {number} status
   * @param {string} body  – raw response text
   */
  _mapError(status, body) {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch (_) {}
    const msg = parsed.message || body || "Unknown error";

    switch (status) {
      case 401: return new GitHubError(`Invalid token: ${msg}`, GH_ERROR_CODES.INVALID_TOKEN, status);
      case 403:
        if (msg.toLowerCase().includes("rate limit")) {
          return new GitHubError("GitHub API rate limit exceeded. Try again later.", GH_ERROR_CODES.RATE_LIMITED, status);
        }
        return new GitHubError(`Permission denied: ${msg}`, GH_ERROR_CODES.NO_PERMISSION, status);
      case 404: return new GitHubError(`Repository or file not found: ${msg}`, GH_ERROR_CODES.REPO_NOT_FOUND, status);
      case 409: return new GitHubError(`SHA conflict — please retry: ${msg}`, GH_ERROR_CODES.SHA_MISMATCH, status);
      case 422: return new GitHubError(`Unprocessable entity: ${msg}`, GH_ERROR_CODES.SHA_MISMATCH, status);
      default:  return new GitHubError(`GitHub error (${status}): ${msg}`, GH_ERROR_CODES.UNKNOWN, status);
    }
  }

  /**
   * Raw fetch wrapper — throws GitHubError on non-2xx.
   * @param {string} url
   * @param {RequestInit} [opts]
   * @returns {Promise<any>}  parsed JSON body
   */
  async _fetch(url, opts = {}) {
    let response;
    try {
      response = await fetch(url, { ...opts, headers: this._headers() });
    } catch (e) {
      throw new GitHubError(`Network failure: ${e.message}`, GH_ERROR_CODES.NETWORK_FAILURE);
    }

    const text = await response.text();

    if (!response.ok) {
      throw this._mapError(response.status, text);
    }

    try { return JSON.parse(text); } catch (_) { return text; }
  }

  // ── public API ────────────────────────────────────────────────────────────

  /**
   * Verify the PAT by calling /user.
   * @returns {Promise<{login: string, name: string}>}
   */
  async verifyToken() {
    const user = await this._fetch(`${this._base}/user`);
    return { login: user.login, name: user.name, avatarUrl: user.avatar_url, email: user.email };
  }

  /**
   * Verify that a repository exists and is accessible.
   * @param {string} owner
   * @param {string} repo
   * @returns {Promise<{full_name: string, private: boolean, default_branch: string}>}
   */
  async verifyRepository(owner, repo) {
    const data = await this._fetch(`${this._base}/repos/${owner}/${repo}`);
    return {
      full_name:      data.full_name,
      private:        data.private,
      default_branch: data.default_branch,
    };
  }

  /**
   * Fetch file metadata (including the SHA required for updates).
   * Returns null when file does not exist.
   * @param {string} owner
   * @param {string} repo
   * @param {string} path   – path inside the repo (no leading slash)
   * @returns {Promise<{sha: string, content: string, encoding: string} | null>}
   */
  async getFile(owner, repo, path) {
    const url = `${this._base}/repos/${owner}/${repo}/contents/${path}`;
    let response;
    try {
      response = await fetch(url, { headers: this._headers() });
    } catch (e) {
      throw new GitHubError(`Network failure: ${e.message}`, GH_ERROR_CODES.NETWORK_FAILURE);
    }

    if (response.status === 404) return null;

    const text = await response.text();
    if (!response.ok) throw this._mapError(response.status, text);

    return JSON.parse(text);
  }

  /**
   * Create a new file (path must not exist).
   * @param {string} owner
   * @param {string} repo
   * @param {string} path
   * @param {string} content  – raw string content
   * @param {string} message  – commit message
   * @returns {Promise<{commit: {sha: string}, content: {sha: string}}>}
   */
  async createFile(owner, repo, path, content, message) {
    const url = `${this._base}/repos/${owner}/${repo}/contents/${path}`;
    return this._fetch(url, {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: _toBase64(content),
      }),
    });
  }

  /**
   * Update an existing file. Always fetches the latest SHA first.
   * @param {string} owner
   * @param {string} repo
   * @param {string} path
   * @param {string} content  – new raw string content
   * @param {string} message  – commit message
   * @returns {Promise<{commit: {sha: string}, content: {sha: string}}>}
   */
  async updateFile(owner, repo, path, content, message) {
    const existing = await this.getFile(owner, repo, path);
    if (!existing) throw new GitHubError("File does not exist — use createFile.", GH_ERROR_CODES.REPO_NOT_FOUND);

    const url = `${this._base}/repos/${owner}/${repo}/contents/${path}`;
    return this._fetch(url, {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: _toBase64(content),
        sha: existing.sha,
      }),
    });
  }

  /**
   * Create or update a file safely.
   * Always fetches the latest SHA before writing — never uses a cached value.
   * @param {string} owner
   * @param {string} repo
   * @param {string} path
   * @param {string} content
   * @param {string} message
   * @returns {Promise<{commit: {sha: string}, content: {sha: string}, created: boolean}>}
   */
  async createOrUpdateFile(owner, repo, path, content, message) {
    // Always fetch fresh SHA — never rely on a previously stored value
    const existing = await this.getFile(owner, repo, path);
    const url = `${this._base}/repos/${owner}/${repo}/contents/${path}`;

    const body = {
      message,
      content: _toBase64(content),
    };
    if (existing) body.sha = existing.sha;

    const result = await this._fetch(url, {
      method: "PUT",
      body:   JSON.stringify(body),
    });

    return { ...result, created: !existing };
  }
  /**
   * List top-level directories in a repository.
   * @param {string} owner
   * @param {string} repo
   * @param {string} [path=""]  – optional sub-path to list
   * @returns {Promise<Array<{name: string, type: string, path: string}>>}
   */
  async listDirectory(owner, repo, path = "") {
    const url = path
      ? `${this._base}/repos/${owner}/${repo}/contents/${path}`
      : `${this._base}/repos/${owner}/${repo}/contents`;
    let response;
    try {
      response = await fetch(url, { headers: this._headers() });
    } catch (e) {
      throw new GitHubError(`Network failure: ${e.message}`, GH_ERROR_CODES.NETWORK_FAILURE);
    }

    if (response.status === 404) return [];

    const text = await response.text();
    if (!response.ok) throw this._mapError(response.status, text);

    const items = JSON.parse(text);
    if (!Array.isArray(items)) return [];

    return items.map(item => ({
      name: item.name,
      type: item.type, // "file" | "dir"
      path: item.path,
    }));
  }

  /**
   * List all repositories for the authenticated user.
   * Fetches all pages (up to 200 repos total).
   * @param {number} [perPage=100]
   * @returns {Promise<Array<{name:string, fullName:string, private:boolean,
   *                          description:string, branch:string, owner:string}>>}
   */
  async listUserRepositories(perPage = 100) {
    const repos = [];
    let page = 1;
    while (true) {
      const url = `${this._base}/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner`;
      let batch;
      try {
        batch = await this._fetch(url);
      } catch (_) {
        break;
      }
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const r of batch) {
        repos.push({
          name:        r.name,
          fullName:    r.full_name,
          private:     r.private,
          description: r.description || "",
          branch:      r.default_branch || "main",
          owner:       r.owner?.login || "",
        });
      }
      if (batch.length < perPage) break;
      page++;
    }
    return repos;
  }

  /**
   * Recursively list all folders under a path (max 2 levels deep).
   * @param {string} owner
   * @param {string} repo
   * @param {string} [basePath=""]
   * @param {number} [depth=0]
   * @returns {Promise<string[]>}  array of folder paths
   */
  async listFoldersRecursive(owner, repo, basePath = "", depth = 0) {
    const items = await this.listDirectory(owner, repo, basePath);
    const folders = items.filter(i => i.type === "dir" && !i.name.startsWith("."));
    const result = folders.map(f => f.path);

    if (depth < 1) {
      for (const folder of folders) {
        try {
          const nested = await this.listFoldersRecursive(owner, repo, folder.path, depth + 1);
          result.push(...nested);
        } catch (_) { /* skip unreadable dirs */ }
      }
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Encode a UTF-8 string to Base64 (handles non-ASCII characters).
 * @param {string} str
 * @returns {string}
 */
function _toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary);
}
