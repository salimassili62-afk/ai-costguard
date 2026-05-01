# AI Execution Firewall Comparison

This page explains where AIFW fits beside common LLM infrastructure.

## Positioning

AIFW is a pre-execution enforcement layer. It blocks risky requests before model execution, then emits structured decision data for other systems to observe.

## Comparison

| Product category | Primary job | AIFW relationship |
| --- | --- | --- |
| LLM observability | Trace prompts, costs, latency, quality, and sessions | Complementary; AIFW sends cleaner decisions upstream |
| AI gateway | Route traffic, keys, rate limits, retries, provider failover | Complementary; AIFW can run before or beside the gateway |
| App monitoring | Infrastructure logs, metrics, alerts | Complementary; AIFW exports metrics and webhooks |
| Policy engine | Access control and governance | AIFW focuses specifically on AI spend and runaway execution |

## When To Use AIFW

- You run autonomous or semi-autonomous agents.
- You need tenant, workflow, user, or agent budgets.
- You need a hard kill switch, not just a dashboard.
- You cannot store plaintext prompts in production logs.
- You want local-first enforcement with no telemetry.

## When Not To Use AIFW Alone

- You need full prompt analytics, evaluations, or quality scoring.
- You need hosted dashboards for every trace.
- You need provider failover and routing as the primary feature.

Use AIFW for enforcement, then pair it with the observability or gateway tool your team already trusts.
