/**
 * Validates a configured webhook destination before anything is sent.
 *
 * Webhook delivery is observability only and never affects a guard decision, but it is still an
 * outbound request made with the application's network position. This policy keeps that request
 * from being pointed at an arbitrary plaintext endpoint:
 *
 * - `https:` is allowed for any host.
 * - `http:` is allowed only for loopback (`localhost`, `127.0.0.1`, `[::1]`), so local development
 *   receivers keep working without requiring TLS.
 * - Any other scheme, and any URL that cannot be parsed, is rejected.
 *
 * The caller treats a `false` result as "do not send" and must never throw because of it.
 */
export function isValidWebhookUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'https:') return true;
  if (protocol === 'http:') {
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  }
  return false;
}
