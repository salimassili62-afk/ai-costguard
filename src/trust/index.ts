/**
 * Trust Layer - Production-grade audit with cryptographic integrity
 * 
 * Exports:
 * - ImmutableAudit: Append-only hash-chained audit log
 * - PublicVerificationLedger: Externally verifiable signed proofs
 * - verifyIntegrity(): Detects ANY tampering
 */

export {
  ImmutableAudit,
  AuditEntry,
  ExecutionTrace,
  IntegrityReport,
  ReplayResult,
  immutableAudit,
  createImmutableAudit,
} from './ImmutableAudit';

export {
  PublicVerificationLedger,
  SignedMetric,
  PublicProof,
  VerificationReport,
  publicLedger,
  createPublicLedger,
} from './PublicVerificationLedger';
