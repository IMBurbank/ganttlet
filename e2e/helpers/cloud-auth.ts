/**
 * cloud-auth.ts — Exchange a GCP service account JSON key for a Google access token.
 * Used by E2E tests running against live Cloud Run deployments.
 */
import { createSign } from 'crypto';

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Exchange a service account JSON key for a Google access token.
 * Uses JWT assertion grant — no gcloud or client libraries needed.
 */
export async function getAccessToken(keyJson: string, extraScopes?: string[]): Promise<string> {
  const key: ServiceAccountKey = JSON.parse(keyJson);
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    ...(extraScopes || []),
  ];
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: scopes.join(' '),
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(key.private_key));

  const jwt = `${header}.${claims}.${signature}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

/**
 * Get the email address from a service account JSON key.
 */
export function getServiceAccountEmail(keyJson: string): string {
  const key: ServiceAccountKey = JSON.parse(keyJson);
  return key.client_email;
}
