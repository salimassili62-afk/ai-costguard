import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface StructuredLog {
  timestamp: string;
  requestId: string;
  decision: string;
  estimatedCostUsd: number;
  latencyMs: number;
  reason: string;
}

export class AuditLogger {
  constructor(private readonly streamPath = 'audit/firewall-audit.log') {
    const folder = dirname(streamPath);
    if (!existsSync(folder)) {
      mkdirSync(folder, { recursive: true });
    }
  }

  log(entry: StructuredLog): void {
    const line = JSON.stringify(entry);
    // Append-only audit stream for enterprise traceability.
    appendFileSync(this.streamPath, `${line}\n`, { encoding: 'utf8' });
  }
}
