declare namespace google.accounts.oauth2 {
  interface TokenClient {
    requestAccessToken(overridableClientConfig?: { prompt?: string }): void;
  }

  interface TokenResponse {
    access_token: string;
    expires_in: string;
    error?: string;
    error_description?: string;
    scope: string;
    token_type: string;
  }

  function initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type: string; message: string }) => void;
  }): TokenClient;

  function revoke(accessToken: string, done: () => void): void;
}
