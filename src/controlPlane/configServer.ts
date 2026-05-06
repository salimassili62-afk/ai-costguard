import express, { Request, Response } from 'express';
import { GuardPolicy } from '../firewall/types';
import { UsageLimitConfig } from '../saas/usageMeter';
import { runDemo } from '../demo/demoRunner';
import { toRoiDashboard } from '../dashboard/roiDashboard';

type KeyConfig = {
  policy?: Partial<GuardPolicy>;
  usage?: Partial<UsageLimitConfig>;
  maxCostPerDay?: number;
};

export class ConfigServer {
  private readonly app = express();
  private readonly keyConfigs = new Map<string, KeyConfig>();

  constructor() {
    this.app.use(express.json());

    this.app.get('/dashboard', (_req: Request, res: Response) => {
      const demo = runDemo();
      res.json(toRoiDashboard(demo));
    });

    this.app.post('/config/update', (req: Request, res: Response) => {
      const body = req.body as { key: string; maxCostPerDay?: number; policy?: Partial<GuardPolicy>; usage?: Partial<UsageLimitConfig> };
      if (!body?.key) {
        return res.status(400).json({ error: 'key is required' });
      }
      const previous = this.keyConfigs.get(body.key) ?? {};
      const next: KeyConfig = {
        ...previous,
        maxCostPerDay: body.maxCostPerDay ?? previous.maxCostPerDay,
        policy: { ...(previous.policy ?? {}), ...(body.policy ?? {}) },
        usage: { ...(previous.usage ?? {}), ...(body.usage ?? {}) },
      };
      this.keyConfigs.set(body.key, next);
      return res.json({ ok: true, key: body.key, config: next });
    });

    this.app.get('/config/:key', (req: Request, res: Response) => {
      const config = this.keyConfigs.get(req.params.key);
      if (!config) {
        return res.status(404).json({ error: 'key not found' });
      }
      return res.json({ key: req.params.key, config });
    });
  }

  listen(port = 3001) {
    return this.app.listen(port);
  }
}
