'use client'

import { useState } from 'react'

const installCommand = 'npm install @salimassili/ai-costguard'

const demoCommands = [
  'npm install @salimassili/ai-costguard',
  'node examples/integrations/quick-demo.mjs',
]

const GITHUB_URL = 'https://github.com/salimassili62-afk/ai-costguard'
const NPM_URL = 'https://www.npmjs.com/package/@salimassili/ai-costguard'

const features = [
  'Budget enforcement before the provider is called',
  'Prompt loop and retry storm detection',
  'Max-step and scope limits',
  'Unknown-model pricing protection',
  'Scoped budgets per project, user, or session',
  'Structured GuardError codes for API responses',
  'Webhook and Slack alerts you host yourself',
  'Local JSONL event log and dashboard',
  'CLI budget checks for CI',
  'Redis shared budgets via the /pro subpath',
]

const guarantees = [
  'No blocked request ever reached the provider.',
  'Concurrent in-process callers cannot overspend a shared budget.',
  'No call is ever allowed uncounted: a pre-call estimate is always reserved, and a model the registry cannot price is blocked.',
]

const honestLimits = [
  'The budget is enforced against a pre-call estimate, not a provider bill.',
  'Reservations are not refunded, even when the provider call fails.',
  'Input tokens are approximated unless you register an exact tokenizer.',
  'Built-in pricing is a dated snapshot, not a live price feed.',
  'The guard is process-local; cross-process budgets need a shared store.',
  'Streaming requests are blocked rather than charged.',
  'Loop and retry detection are heuristics, not a correctness boundary.',
  'Not enterprise security software or a hard security boundary.',
]

const demoProofs = [
  'No API key, network, or money required',
  'Blocks before provider execution',
  'Runs against a mock provider',
]

export default function Home() {
  const [copied, setCopied] = useState(false)

  const copyInstall = async () => {
    await navigator.clipboard.writeText(installCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <section className="container mx-auto px-4 pb-16 pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-green-500">
            Local-first AI agent cost protection
          </p>

          <h1 className="mb-5 text-4xl font-bold leading-tight text-white md:text-5xl">
            Stop runaway AI-agent API calls before they hit your bill.
          </h1>

          <p className="mx-auto mb-6 max-w-2xl text-lg leading-relaxed text-gray-400">
            AI CostGuard is a Node.js runtime safety layer for AI agents. It checks the cost of a model
            call before your provider sees it, and blocks the call when the budget or a safety policy
            would be exceeded.
          </p>

          <p className="mx-auto mb-8 max-w-2xl text-sm leading-relaxed text-gray-500">
            Free and MIT licensed. No dependencies, no API key, no account, no telemetry, no paid tier,
            and no license check.
          </p>

          <div className="terminal mx-auto mb-6 max-w-lg text-left">
            <span className="text-gray-500">$ </span>
            <span className="text-gray-200">{installCommand}</span>
          </div>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              id="copy-install-btn"
              onClick={copyInstall}
              className="rounded-lg bg-green-600 px-7 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
            >
              {copied ? 'Copied' : 'Install Free'}
            </button>

            <a
              href={NPM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-gray-700 px-7 py-2.5 text-sm font-semibold text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
            >
              View on npm
            </a>

            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-gray-700 px-7 py-2.5 text-sm font-semibold text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
            >
              GitHub
            </a>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <div className="mx-auto grid max-w-5xl gap-6 rounded-lg border border-gray-800 bg-gray-900 p-6 md:grid-cols-[1.1fr_0.9fr] md:p-8">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-green-500">
              Mocked local demo
            </p>

            <h2 className="mb-4 text-2xl font-bold leading-tight text-white">
              See it block a risky AI call before it reaches the provider
            </h2>

            <p className="mb-5 text-sm leading-relaxed text-gray-400">
              The demo runs locally against a mock provider. It needs no API key, makes no network
              calls, and costs nothing. It prints the provider call count, which is the proof: the
              blocked request never arrived.
            </p>

            <div className="grid gap-2">
              {demoProofs.map((item) => (
                <CheckRow key={item} text={item} />
              ))}
            </div>
          </div>

          <div className="terminal h-fit">
            {demoCommands.map((command) => (
              <div key={command} className="terminal-line">
                <span className="text-gray-500">$ </span>
                <span>{command}</span>
              </div>
            ))}
            <div className="terminal-line">
              <span className="text-gray-500">&gt; </span>
              <span className="text-gray-200">Provider calls: 2</span>
            </div>
            <div className="terminal-line">
              <span className="text-gray-500">&gt; </span>
              <span className="text-red-400">Blocked provider calls: 1</span>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-8 text-center text-2xl font-bold text-white">What You Get</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            {features.map((item) => (
              <CheckRow key={item} text={item} />
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-4xl rounded-lg border border-green-900/40 bg-green-950/20 p-8">
          <h2 className="mb-4 text-center text-2xl font-bold text-white">
            What Is Actually Guaranteed
          </h2>

          <p className="mb-6 text-center text-sm leading-relaxed text-gray-400">
            Precise claims, because &ldquo;it stops runaway costs&rdquo; is too coarse to be useful.
          </p>

          <div className="grid gap-3">
            {guarantees.map((item) => (
              <CheckRow key={item} text={item} />
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-6 text-center text-2xl font-bold text-white">Honest Limits</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            {honestLimits.map((item) => (
              <div
                key={item}
                className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-300"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-2xl rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-green-500">
            Open source
          </p>

          <h2 className="mb-3 text-2xl font-bold text-white">Read the source. It is all there.</h2>

          <p className="mb-6 text-sm leading-relaxed text-gray-400">
            The guard is a few thousand lines with no runtime dependencies. Every documented limit on
            this page is a design decision you can read in the code, not a policy you have to trust.
          </p>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg bg-green-600 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
          >
            View on GitHub
          </a>
        </div>
      </section>

      <footer className="container mx-auto px-4 py-8 text-center text-sm text-gray-400">
        <div className="mx-auto max-w-3xl">
          <a href="/privacy" className="underline">
            Privacy
          </a>
          <span className="mx-2">·</span>
          <a href="/terms" className="underline">
            Terms
          </a>
        </div>
      </footer>
    </main>
  )
}

function CheckRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-gray-300">
      <span className="mt-0.5 shrink-0 text-green-500">+</span>
      <span>{text}</span>
    </div>
  )
}
