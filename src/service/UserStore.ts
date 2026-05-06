/**
 * UserStore.ts - Simple user management for SaaS
 * 
 * Features:
 * - User accounts (email or anonymous)
 * - API key generation and management
 * - Session tokens (JWT-like simple tokens)
 * - In-memory storage (replace with database for production)
 */

import * as crypto from 'crypto';

export interface User {
  id: string;
  email: string | null;
  anonymous: boolean;
  createdAt: number;
  lastLoginAt: number;
}

export interface ApiKey {
  id: string;
  userId: string;
  key: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * UserStore - Manages users, API keys, and sessions
 * 
 * Simplified for demo purposes. Replace with real database for production.
 */
export class UserStore {
  private users: Map<string, User> = new Map();
  private apiKeys: Map<string, ApiKey> = new Map();
  private sessions: Map<string, Session> = new Map();
  private emailIndex: Map<string, string> = new Map(); // email -> userId

  /**
   * Create a new user with email
   */
  createUser(email: string): User {
    const id = this.generateId();
    const now = Date.now();
    
    const user: User = {
      id,
      email,
      anonymous: false,
      createdAt: now,
      lastLoginAt: now,
    };

    this.users.set(id, user);
    this.emailIndex.set(email, id);

    return user;
  }

  /**
   * Create anonymous user (no email required)
   */
  createAnonymousUser(): User {
    const id = this.generateId();
    const now = Date.now();
    
    const user: User = {
      id,
      email: null,
      anonymous: true,
      createdAt: now,
      lastLoginAt: now,
    };

    this.users.set(id, user);

    return user;
  }

  /**
   * Find user by email
   */
  findByEmail(email: string): User | undefined {
    const userId = this.emailIndex.get(email);
    if (userId) {
      return this.users.get(userId);
    }
    return undefined;
  }

  /**
   * Get user by ID
   */
  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  /**
   * Create API key for user
   */
  createApiKey(userId: string, name: string): ApiKey {
    const id = this.generateId();
    const key = 'ak_' + crypto.randomBytes(24).toString('base64url');
    
    const apiKey: ApiKey = {
      id,
      userId,
      key,
      name,
      createdAt: Date.now(),
      lastUsedAt: null,
    };

    this.apiKeys.set(id, apiKey);
    return apiKey;
  }

  /**
   * Get all API keys for a user
   */
  getApiKeys(userId: string): ApiKey[] {
    return Array.from(this.apiKeys.values()).filter(k => k.userId === userId);
  }

  /**
   * Find API key by key string
   */
  findApiKey(key: string): ApiKey | undefined {
    return Array.from(this.apiKeys.values()).find(k => k.key === key);
  }

  /**
   * Update last used timestamp
   */
  updateApiKeyLastUsed(id: string): void {
    const key = this.apiKeys.get(id);
    if (key) {
      key.lastUsedAt = Date.now();
    }
  }

  /**
   * Create session token
   */
  createSession(userId: string): Session {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = now + (7 * 24 * 60 * 60 * 1000); // 7 days

    const session: Session = {
      token,
      userId,
      createdAt: now,
      expiresAt,
    };

    this.sessions.set(token, session);
    return session;
  }

  /**
   * Get session by token
   */
  getSession(token: string): Session | undefined {
    return this.sessions.get(token);
  }

  /**
   * Revoke session
   */
  revokeSession(token: string): boolean {
    return this.sessions.delete(token);
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [token, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(token);
        cleaned++;
      }
    }

    return cleaned;
  }

  // Private helpers

  private generateId(): string {
    return crypto.randomBytes(12).toString('base64url');
  }
}

// Singleton instance
export const userStore = new UserStore();
