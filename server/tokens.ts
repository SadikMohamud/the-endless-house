// Signed session tokens: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
// Web Crypto only, so the same code runs on Node, Workers and edge runtimes.

export interface TokenPayload {
  /** Session id: lets the server revoke a token before it expires. */
  sid: string;
  /** Visitor id the session belongs to. */
  vid: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signToken(payload: TokenPayload, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

/**
 * Returns the payload if the signature is valid and the token has not expired; otherwise null.
 * Signature comparison is constant-time (crypto.subtle.verify).
 */
export async function verifyToken(
  token: string,
  secret: string,
  nowSeconds: number,
): Promise<TokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sigText] = parts as [string, string];
  const sig = fromBase64Url(sigText);
  if (!sig) return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    sig,
    encoder.encode(body),
  );
  if (!valid) return null;
  const raw = fromBase64Url(body);
  if (!raw) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  const p = payload as Partial<TokenPayload>;
  if (typeof p.sid !== 'string' || typeof p.vid !== 'string' || typeof p.exp !== 'number')
    return null;
  if (p.exp <= nowSeconds) return null;
  return { sid: p.sid, vid: p.vid, exp: p.exp };
}
