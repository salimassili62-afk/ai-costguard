declare const process: {
  argv: string[];
  exitCode?: number;
  stdout: { write(message: string): void };
  stderr: { write(message: string): void };
  execPath: string;
  env: Record<string, string | undefined>;
};

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): unknown;
  export function appendFileSync(path: string, data: string, encoding?: string): void;
  export function readFileSync(path: string, encoding: string): string;
}

declare module 'node:path' {
  export function dirname(path: string): string;
}

declare module 'node:http' {
  export interface Server {
    once(eventName: 'error', handler: (error: unknown) => void): this;
    off(eventName: 'error', handler: (error: unknown) => void): this;
    listen(port: number, host: string, callback: () => void): this;
    address(): { port: number } | string | null;
    close(callback?: () => void): this;
  }

  export function createServer(
    listener: (
      request: { url?: string },
      response: {
        writeHead(statusCode: number, headers: Record<string, string>): void;
        end(body: string): void;
      }
    ) => void
  ): Server;
}
