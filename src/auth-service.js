/**
 * @fileoverview GitHub Device Flow OAuth Service
 *
 * Implements GitHub's Device Authorization Grant:
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 *
 * Why Device Flow?
 * - Chrome Extensions cannot safely embed a client_secret
 * - Device Flow is designed for apps that can't do a browser redirect
 * - Only the client_id is embedded — it is public and safe
 *
 * SETUP: Register a GitHub App at https://github.com/settings/apps/new
 *   1. Set Homepage URL to any URL (e.g. https://github.com/yourusername/leetgfghub)
 *   2. Uncheck "Webhook"
 *   3. Add Permissions: Contents (Read/Write), Metadata (Read)
 *   4. Under "Where can this GitHub App be installed?" → "Any account"
 *   5. Copy the Client ID from the app's settings page
 *   6. Replace GITHUB_CLIENT_ID below with your Client ID
 */

// ---------------------------------------------------------------------------
// CONFIGURATION — Replace with your GitHub App's Client ID
// ---------------------------------------------------------------------------

const GITHUB_CLIENT_ID = "YOUR_GITHUB_APP_CLIENT_ID";

// Scopes: repo (full repository access for public + private)
const SCOPES = "repo user:email read:user";

// GitHub Device Flow endpoints
const DEVICE_CODE_URL   = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL  = "https://github.com/login/oauth/access_token";
const GITHUB_API_USER   = "https://api.github.com/user";

// ---------------------------------------------------------------------------
// Device Flow
// ---------------------------------------------------------------------------

/**
 * Step 1: Request a device code from GitHub.
 * Returns the data needed to display the user_code and start polling.
 *
 * @returns {Promise<{
 *   deviceCode: string,
 *   userCode: string,
 *   verificationUri: string,
 *   expiresIn: number,
 *   interval: number
 * }>}
 */
export async function requestDeviceCode() {
  const body = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    scope:     SCOPES,
  });

  let response;
  try {
    response = await fetch(DEVICE_CODE_URL, {
      method:  "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body:    body.toString(),
    });
  } catch (e) {
    throw new AuthError(`Network error: ${e.message}`, "NETWORK_FAILURE");
  }

  if (!response.ok) {
    const text = await response.text();
    throw new AuthError(`GitHub returned ${response.status}: ${text}`, "GITHUB_ERROR");
  }

  const data = await response.json();

  if (data.error) {
    throw new AuthError(data.error_description || data.error, "GITHUB_ERROR");
  }

  return {
    deviceCode:      data.device_code,
    userCode:        data.user_code,
    verificationUri: data.verification_uri,
    expiresIn:       data.expires_in,
    interval:        data.interval || 5,
  };
}

/**
 * Step 2: Poll GitHub until the user authorizes.
 *
 * @param {string} deviceCode
 * @param {number} intervalSecs  - polling interval from step 1
 * @param {AbortSignal} [signal] - allows external cancellation
 * @returns {Promise<string>}    - the access token
 */
export async function pollForAccessToken(deviceCode, intervalSecs = 5, signal = null) {
  const body = new URLSearchParams({
    client_id:   GITHUB_CLIENT_ID,
    device_code: deviceCode,
    grant_type:  "urn:ietf:params:oauth:grant-type:device_code",
  });

  let pollInterval = intervalSecs * 1000;
  const maxWait    = 15 * 60 * 1000; // 15 min max
  let elapsed      = 0;

  while (elapsed < maxWait) {
    if (signal?.aborted) throw new AuthError("Authentication cancelled.", "CANCELLED");

    await sleep(pollInterval);
    elapsed += pollInterval;

    let response;
    try {
      response = await fetch(ACCESS_TOKEN_URL, {
        method:  "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body:    body.toString(),
      });
    } catch (e) {
      throw new AuthError(`Network error: ${e.message}`, "NETWORK_FAILURE");
    }

    const data = await response.json();

    if (data.access_token) {
      return data.access_token;
    }

    // Handle polling responses
    switch (data.error) {
      case "authorization_pending":
        // Normal — user hasn't authorized yet, keep polling
        break;
      case "slow_down":
        // GitHub wants us to poll slower
        pollInterval += 5000;
        break;
      case "expired_token":
        throw new AuthError("Device code expired. Please try again.", "EXPIRED");
      case "access_denied":
        throw new AuthError("Authorization denied by user.", "DENIED");
      default:
        if (data.error) {
          throw new AuthError(data.error_description || data.error, "GITHUB_ERROR");
        }
    }
  }

  throw new AuthError("Authentication timed out. Please try again.", "TIMEOUT");
}

/**
 * Fetch the authenticated user's profile from GitHub API.
 * @param {string} token
 * @returns {Promise<{login: string, name: string, avatarUrl: string, email: string}>}
 */
export async function fetchUserProfile(token) {
  let response;
  try {
    response = await fetch(GITHUB_API_USER, {
      headers: {
        Authorization:          `Bearer ${token}`,
        Accept:                 "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (e) {
    throw new AuthError(`Network error: ${e.message}`, "NETWORK_FAILURE");
  }

  if (response.status === 401) {
    throw new AuthError("Token is invalid or expired.", "INVALID_TOKEN");
  }
  if (!response.ok) {
    throw new AuthError(`GitHub error: ${response.status}`, "GITHUB_ERROR");
  }

  const user = await response.json();
  return {
    login:     user.login,
    name:      user.name || user.login,
    avatarUrl: user.avatar_url,
    email:     user.email || "",
  };
}

/**
 * Full authentication flow: request code → open browser → poll → return token.
 * Returns intermediate step data (user code) via callback so UI can render it.
 *
 * @param {(step: object) => void} onStep - called with { userCode, verificationUri } when ready
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ token: string, user: object }>}
 */
export async function authenticate(onStep, signal = null) {
  const step1 = await requestDeviceCode();

  // Notify UI to show the user code
  onStep({
    userCode:        step1.userCode,
    verificationUri: step1.verificationUri,
    expiresIn:       step1.expiresIn,
  });

  // Open verification page in a new tab
  try {
    await chrome.tabs.create({ url: step1.verificationUri });
  } catch (_) {
    // In some contexts tabs API may be restricted — it's non-fatal
  }

  // Poll until authorized
  const token = await pollForAccessToken(step1.deviceCode, step1.interval, signal);

  // Fetch user profile
  const user = await fetchUserProfile(token);

  return { token, user };
}

// ---------------------------------------------------------------------------
// Custom Error
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate a token is still valid by calling /user.
 * Returns user profile on success, null on 401.
 * @param {string} token
 * @returns {Promise<object|null>}
 */
export async function validateToken(token) {
  if (!token) return null;
  try {
    return await fetchUserProfile(token);
  } catch (e) {
    if (e.code === "INVALID_TOKEN") return null;
    throw e;
  }
}
