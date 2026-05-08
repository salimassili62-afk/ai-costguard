/**
 * Example: Express middleware
 *
 * Protect all AI calls in your Express app.
 */

import express from 'express';
import { costGuardMiddleware, CostGuardError } from '../src/index';

const app = express();
app.use(express.json());

// Apply cost guard to all routes
app.use(costGuardMiddleware({ maxTotalCostPerDay: 10.00 }));

app.post('/chat', async (req, res) => {
  const { message } = req.body;

  // Simulated AI call
  const response = { reply: `Echo: ${message}` };
  res.json(response);
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
  console.log('All AI calls are cost-protected');
});
