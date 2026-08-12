import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';

export type LicenseResult =
  | { valid: true; activatedAt: string; instanceId: string }
  | { valid: false; reason: string };

interface LicenseCache {
  key: string;
  valid: boolean;
  activatedAt: string;
  instanceId: string;
  cachedAt: number;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate';

function getCacheDirectory(): string {
  const custom = process.env.COSTGUARD_LICENSE_CACHE_DIR;
  if (custom && custom.trim()) {
    return custom.trim();
  }

  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, '.ai-costguard');
}

function getCachePath(): string {
  return path.join(getCacheDirectory(), 'license-cache.json');
}

export async function validateLicense(key: string): Promise<LicenseResult> {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return { valid: false, reason: 'License key is required.' };
  }

  const cache = await readCache().catch(() => null);
  if (cache && cache.key === normalizedKey && cache.valid && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
    return {
      valid: true,
      activatedAt: cache.activatedAt,
      instanceId: cache.instanceId,
    };
  }

  try {
    const result = await validateRemoteLicense(normalizedKey);
    if (result.valid) {
      await writeCache({
        key: normalizedKey,
        valid: true,
        activatedAt: result.activatedAt,
        instanceId: result.instanceId,
        cachedAt: Date.now(),
      });
    }
    return result;
  } catch (error) {
    const offlineCache = cache;
    if (offlineCache && offlineCache.key === normalizedKey) {
      return {
        valid: true,
        activatedAt: offlineCache.activatedAt,
        instanceId: offlineCache.instanceId,
      };
    }

    return {
      valid: false,
      reason: 'Could not verify license. Check your internet connection.',
    };
  }
}

async function readCache(): Promise<LicenseCache | null> {
  const data = await fs.readFile(getCachePath(), 'utf8');
  const parsed = JSON.parse(data) as LicenseCache;
  if (
    typeof parsed?.key !== 'string' ||
    typeof parsed?.valid !== 'boolean' ||
    typeof parsed?.activatedAt !== 'string' ||
    typeof parsed?.instanceId !== 'string' ||
    typeof parsed?.cachedAt !== 'number'
  ) {
    throw new Error('Invalid cache schema');
  }
  return parsed;
}

async function writeCache(cache: LicenseCache): Promise<void> {
  await fs.mkdir(path.dirname(getCachePath()), { recursive: true });
  await fs.writeFile(getCachePath(), JSON.stringify(cache, null, 2), 'utf8');
}

async function validateRemoteLicense(key: string): Promise<LicenseResult> {
  const body = new URLSearchParams({
    license_key: key,
    instance_name: 'ai-costguard',
  }).toString();

  const url = new URL(VALIDATE_URL);
  const options: https.RequestOptions = {
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const raw = await new Promise<string>((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const data = parsed?.data as Record<string, unknown> | undefined;
  if (!data) {
    return { valid: false, reason: 'Invalid license key' };
  }

  if (data.valid === true) {
    const activatedAt = typeof data.activated_at === 'string' ? data.activated_at : new Date().toISOString();
    const instanceId = typeof data.instance_id === 'string' ? data.instance_id : 'unknown';
    return { valid: true, activatedAt, instanceId };
  }

  const reason = typeof data.error === 'string' ? data.error : 'Invalid license key';
  return { valid: false, reason };
}
