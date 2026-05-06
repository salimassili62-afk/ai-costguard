/**
 * UserStore.ts - SaaS User Management
 * 
 * Minimal, focused user system:
 * - Email OR anonymous accounts
 * - API key generation
 * - Session management
 * - Usage tracking per user
 */

import * as crypto from 'crypto';

export interface User {
  id: string;
  email: string | null;
  anonymous: boolean;
  createdAt: number;
  lastActiveAt: number;
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

export class UserStore {
  private users: Map<string, User> = new Map();
  private apiKeys: Map<string, ApiKey> = new Map();
  private sessions: Map<string, Session> = new Map();
  private emailIndex: Map<string, string> = new Map();

  createUser(email: string): User {
    const id = this.generateId();
    const now = Date.now();
    
    const user: User = {
      id,
      email,
      anonymous: false,
      createdAt: now,
      lastActiveAt: now,
    };

    this.users.set(id, user);
    this.emailIndex.set(email, id);
    return user;
  }

  createAnonymousUser(): User {
    const id = this.generateId();
    const now = Date.now();
    
    const user: User = {
      id,
      email: null,
      anonymous: true,
      createdAt: now,
      lastActiveAt: now,
    };

    this.users.set(id, user);
    return user;
  }

  findByEmail(email: string): User | undefined {
    const id = this.emailIndex.get(email);
    return id ? this.users.get(id) : undefined;
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  createApiKey(userId: string, name: string): ApiKey {
    const id = this.generateId();
    const key = 'ak_live_' + crypto.randomBytes(24).toString('base64url');
    
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

  getApiKeys(userId: string): ApiKey[] {
    return Array.from(this.apiKeys.values())
      .filter(k => k.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  findApiKey(key: string): ApiKey | undefined {
    return Array.from(this.apiKeys.values()).find(k => k.key === key);
  }

  updateApiKeyLastUsed(id: string): void {
    const key = this.apiKeys.get(id);
    if (key) key.lastUsedAt = Date.now();
  }

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

  getSession(token: string): Session | undefined {
    return this.sessions.get(token);
  }

  private generateId(): string {
    return crypto.randomBytes(12).toString('base64url');
  }
}

export const userStore = new UserStore();
