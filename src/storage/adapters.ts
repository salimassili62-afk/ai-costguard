import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PATHS } from '../config/constants';
import { StorageAdapterType, StorageConfig } from '../config/userConfig';

export interface StorageAdapter<TRecord> {
  readonly type: StorageAdapterType;
  load(): TRecord[];
  append(record: TRecord): void;
  clear(): void;
}

export class MemoryStorageAdapter<TRecord> implements StorageAdapter<TRecord> {
  readonly type = 'memory' as const;
  private records: TRecord[] = [];

  load(): TRecord[] {
    return [...this.records];
  }

  append(record: TRecord): void {
    this.records.push(record);
  }

  clear(): void {
    this.records = [];
  }
}

export class JsonlStorageAdapter<TRecord> implements StorageAdapter<TRecord> {
  readonly type = 'jsonl' as const;
  private filePath: string;

  constructor(filePath?: string) {
    const appDir = path.join(os.homedir(), PATHS.APP_DIR);
    if (!fs.existsSync(appDir)) {
      fs.mkdirSync(appDir, { recursive: true });
    }
    this.filePath = filePath || path.join(appDir, PATHS.HISTORY_FILE);
  }

  load(): TRecord[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    return fs
      .readFileSync(this.filePath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as TRecord);
  }

  append(record: TRecord): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf-8');
  }

  clear(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

class OptionalExternalStorageAdapter<TRecord> implements StorageAdapter<TRecord> {
  readonly type: StorageAdapterType;
  private name: string;

  constructor(type: 'sqlite' | 'postgres') {
    this.type = type;
    this.name = type === 'sqlite' ? 'SQLite' : 'Postgres';
  }

  load(): TRecord[] {
    throw new Error(
      `${this.name} storage is configured but the production adapter is not installed in this package build yet. Use "jsonl" or "memory", or provide a custom adapter with createStorageAdapter().`
    );
  }

  append(): void {
    throw new Error(
      `${this.name} storage is configured but the production adapter is not installed in this package build yet. Use "jsonl" or "memory", or provide a custom adapter with createStorageAdapter().`
    );
  }

  clear(): void {
    throw new Error(
      `${this.name} storage is configured but the production adapter is not installed in this package build yet. Use "jsonl" or "memory", or provide a custom adapter with createStorageAdapter().`
    );
  }
}

export function createStorageAdapter<TRecord>(config: Partial<StorageConfig> = {}): StorageAdapter<TRecord> {
  const adapter = config.adapter || 'jsonl';

  if (adapter === 'memory') {
    return new MemoryStorageAdapter<TRecord>();
  }

  if (adapter === 'jsonl') {
    return new JsonlStorageAdapter<TRecord>(config.path);
  }

  return new OptionalExternalStorageAdapter<TRecord>(adapter);
}
