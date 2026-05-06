/**
 * Ambient Layer - Runtime Execution Constraint
 * 
 * Protection that activates automatically on import.
 * No function call. No configuration. Just import.
 * 
 * import 'ai-costguard'  // → Protection is now active
 */

export {
  AmbientProtection,
  ambientProtection,
  getAmbientStatus,
  disableAmbientProtection,
} from './AmbientProtection';
