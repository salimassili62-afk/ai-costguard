# AI Execution Firewall

Stop AI agents from silently burning your API money.

## The Problem

AI applications can:

- Run infinite loops
- Send duplicate requests
- Spam APIs unintentionally
- Create sudden cost spikes

You usually notice after the bill arrives.

## The Solution

AI Execution Firewall sits between your code and AI APIs and prevents expensive mistakes in real time.

It:

- Detects wasteful requests
- Blocks runaway loops
- Prevents duplicate calls
- Stops cost spikes before execution

## What it prevents

- Unexpected API bills ($50–$500+)
- Infinite request loops
- Duplicate AI calls
- High-cost prompt explosions

## Installation

```bash
npm install -g ai-execution-firewall
Quick Start
aifw start
Test a request
aifw check "generate 10000 tokens"
Modes
monitor: log only
warn: allow but alert
block: stop dangerous requests
Works with
OpenAI
Anthropic
Any AI API via proxy mode
Summary

Safer AI systems with lower costs and predictable usage.

MIT License

