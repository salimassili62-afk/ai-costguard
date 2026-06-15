'use client'

import { useState } from 'react'

const installCommand = 'npm install @salimassili/ai-costguard'
const LS_PRO_URL = 'https://salimassili.lemonsqueezy.com/buy/ai-costguard-pro'
const GITHUB_URL = 'https://github.com/salimassili62-afk/ai-costguard'
const NPM_URL = 'https://www.npmjs.com/package/@salimassili/ai-costguard'

// ─── Data ────────────────────────────────────────────────────────────────────

const features = [
  {
    title: 'Pre-call budget checks',
    body: 'Estimate input and reserved output cost before the provider method executes. Block the call if it would exceed budget.',
  },
  {
    title: 'Agent loop detection',
    body: 'Detect repeated prompts using character trigram cosine similarity. TTL-bounded prompt history per scope.',
  },
  {
    title: 'Retry storm prevention',
    body: 'Track retry/failure signals per session. Block runaway retry loops before they accumulate provider cost.',
  },
  {
    title: 'Scoped isolation',
    body: 'Isolate budgets and behavior history per project, user, or session with a single scope object.',
  },
  {
    title: 'CLI budget checks',
    body: 'Fail CI pipelines before a planned agent run can exceed budget. Works in any shell or GitHub Action.',
  },
  {
    title: 'Structured GuardErrors',
    body: 'Blocked requests throw GuardError with a machine-readable code: BUDGET_EXCEEDED, LOOP_DETECTED, and more.',
  },
]

const freeFeatures = [
  'guard() and guardFunction() wrappers',
  'Pre-call cost estimation',
  'Loop and retry-storm detection',
  'Scoped budget isolation (process-local)',
  'Structured GuardError codes',
  'Event hooks (block / allow / cost)',
  'Express middleware',
  'CLI budget checks',
  'Local JSONL event log + dashboard',
  'MIT license, zero cloud dependency',
]

const proFeatures = [
  'Everything in Free',
  'Redis/GuardPro setup guide',
  'Multi-process shared budget example',
  'Environment-variable Redis/webhook config guidance',
  'Monthly updates as production materials are completed',
  'Planned multi-tenant and tokenizer recipes',
  'Planned GuardError and pricing override guides',
]

// ─── Components ──────────────────────────────────────────────────────────────

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <h3 className="mb-2 text-base font-semibold text-white">{title}</h3>
      <p className="text-sm leading-relaxed text-gray-400">{body}</p>
    </div>
  )
}

function CheckItem({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <li className={`flex items-start gap-2 text-sm ${muted ? 'text-gray-500' : 'text-gray-300'}`}>
      <span className="mt-0.5 text-green-500 shrink-0">✓</span>
      {text}
    </li>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(installCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="container mx-auto px-4 pt-20 pb-16">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-green-500">
            Local-first · No cloud · MIT
          </p>
          <h1 className="mb-5 text-4xl font-bold leading-tight text-white md:text-5xl">
            Stop runaway AI agents<br />before they hit your bill.
          </h1>
          <p className="mx-auto mb-8 max-w-xl text-lg text-gray-400">
            AI CostGuard wraps your OpenAI, Anthropic, or Vercel AI SDK client, estimates cost before
            every call, and blocks budget overruns, loops, and retry storms — entirely in process.
          </p>

          {/* Install bar */}
          <div className="terminal mx-auto mb-6 max-w-lg text-left">
            <span className="text-gray-500">$ </span>
            <span className="text-gray-200">{installCommand}</span>
          </div>

          {/* CTAs */}
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              id="copy-install-btn"
              onClick={copy}
              className="rounded-lg bg-green-600 px-7 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
            >
              {copied ? '✓ Copied' : 'Copy Install Command'}
            </button>
            <a
              id="get-pro-btn"
              href={LS_PRO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-orange-600 px-7 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
            >
              Get Pro — $19/mo
            </a>
            <a
              id="view-source-btn"
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-gray-700 px-7 py-2.5 text-sm font-semibold text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
            >
              GitHub ↗
            </a>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-8 text-center text-2xl font-bold text-white">What it guards</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <FeatureCard key={f.title} title={f.title} body={f.body} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Before / After ───────────────────────────────────────────── */}
      <section className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-8 text-center text-2xl font-bold text-white">One-line migration</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-400">Before</p>
              <div className="terminal">
                <p className="terminal-line">import OpenAI from &apos;openai&apos;;</p>
                <p className="terminal-line">&nbsp;</p>
                <p className="terminal-line">const openai = new OpenAI({'{'}</p>
                <p className="terminal-line">&nbsp; apiKey: process.env.OPENAI_API_KEY,</p>
                <p className="terminal-line">{'}'});</p>
                <p className="terminal-line">&nbsp;</p>
                <p className="terminal-line">await openai.chat.completions.create(req);</p>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-green-400">After</p>
              <div className="terminal">
                <p className="terminal-line">import OpenAI from &apos;openai&apos;;</p>
                <p className="terminal-line"><span className="text-green-400">import {'{ guard }'} from &apos;@salimassili/ai-costguard&apos;;</span></p>
                <p className="terminal-line">&nbsp;</p>
                <p className="terminal-line"><span className="text-green-400">const openai = guard(</span>new OpenAI({'{'}</p>
                <p className="terminal-line">&nbsp; apiKey: process.env.OPENAI_API_KEY,</p>
                <p className="terminal-line"><span className="text-green-400">{'}'}){',' } {'{ budget: 5, maxSteps: 50 }'});</span></p>
                <p className="terminal-line">&nbsp;</p>
                <p className="terminal-line">await openai.chat.completions.create(req);</p>
              </div>
            </div>
          </div>
          <p className="mt-4 text-center text-sm text-gray-500">
            Existing call sites unchanged. GuardError is thrown before the provider is reached.
          </p>
        </div>
      </section>

      {/* ── What it is / is not ──────────────────────────────────────── */}
      <section className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h2 className="mb-4 text-xl font-bold text-white">What it is</h2>
              <div className="space-y-3 text-sm text-gray-300">
                <p className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                  A small npm package for Node.js apps that want runtime guardrails around AI SDK calls and agent steps.
                </p>
                <p className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                  A pre-call cost estimator — not a billing ledger. Block before spend, not after.
                </p>
                <p className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                  Works with OpenAI, Anthropic, Vercel AI SDK, LangChain adapters, Mastra, and any function-style SDK call.
                </p>
              </div>
            </div>
            <div>
              <h2 className="mb-4 text-xl font-bold text-white">What it is not</h2>
              <div className="space-y-3 text-sm text-gray-300">
                <p className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                  Not a SaaS control plane, proxy gateway, billing ledger, telemetry system, or auth layer.
                </p>
                <p className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                  Not a guarantee of exact billing match. Token estimation is approximate unless you register a tokenizer.
                </p>
                <p className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                  The dashboard is local-only and file-backed. No hosted analytics.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Free vs Pro ──────────────────────────────────────────────── */}
      <section id="pro" className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-2 text-center text-2xl font-bold text-white">Free vs Pro</h2>
          <p className="mb-8 text-center text-sm text-gray-500">
            Free is the open-source npm package, forever. Pro is a $19/month or $199/year plan for production materials.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Free */}
            <div className="rounded-lg border border-gray-700 bg-gray-900 p-6">
              <div className="mb-4 flex items-baseline justify-between">
                <h3 className="text-lg font-bold text-white">Free</h3>
                <span className="text-sm text-gray-400">MIT · open source</span>
              </div>
              <ul className="space-y-2">
                {freeFeatures.map((f) => (
                  <CheckItem key={f} text={f} />
                ))}
              </ul>
              <a
                id="free-npm-btn"
                href={NPM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 block rounded-lg border border-gray-700 py-2.5 text-center text-sm font-semibold text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
              >
                View on npm ↗
              </a>
            </div>

            {/* Pro */}
            <div className="rounded-lg border border-orange-700/60 bg-gray-900 p-6">
              <div className="mb-1 flex items-baseline justify-between">
                <h3 className="text-lg font-bold text-white">Pro</h3>
                <span className="text-sm font-semibold text-orange-400">$19/month</span>
              </div>
              <p className="mb-4 text-xs text-gray-500">$199/year option · cancel anytime</p>
              <ul className="space-y-2">
                {proFeatures.map((f) => (
                  <CheckItem key={f} text={f} />
                ))}
              </ul>
              <a
                id="pro-subscribe-btn"
                href={LS_PRO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 block rounded-lg bg-orange-600 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-orange-700"
              >
                Subscribe — $19/month →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pro CTA banner ───────────────────────────────────────────── */}
      <section className="pro-banner container mx-auto px-4 py-12">
        <div className="mx-auto max-w-2xl rounded-lg border border-orange-800/40 bg-orange-950/20 p-8 text-center">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-orange-400">
            Production plan · local-first
          </p>
          <h2 className="mb-3 text-2xl font-bold text-white">
            AI CostGuard Pro
          </h2>
          <p className="mb-6 text-sm leading-relaxed text-gray-400">
            Redis setup guide, multi-process shared-budget example, and monthly production-material
            updates — $19/month or $199/year, cancel anytime.
            Lemon Squeezy handles subscription management. No runtime license enforcement, no SaaS backend.
          </p>
          <a
            id="pro-banner-btn"
            href={LS_PRO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg bg-orange-600 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
          >
            Get AI CostGuard Pro — $19/month
          </a>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-800 py-8 text-center">
        <div className="container mx-auto px-4">
          <p className="mb-3 text-sm text-gray-500">
            AI CostGuard · MIT license · Node ≥ 18 · no cloud dependency
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <a href={NPM_URL} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
              npm ↗
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
              GitHub ↗
            </a>
            <a href={LS_PRO_URL} target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300 transition-colors">
              Pro ($19/mo) ↗
            </a>
          </div>
        </div>
      </footer>

    </main>
  )
}
