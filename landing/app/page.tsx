'use client'

import { useState } from 'react'

const installCommand = 'npm install @salimassili/ai-costguard'

export default function Home() {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(installCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <section className="container mx-auto px-4 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-green-500">
            Local-first runtime safety layer
          </p>
          <h1 className="mb-6 text-5xl font-bold text-white md:text-6xl">
            Stop runaway AI agents before they hit your provider bill.
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-xl text-gray-400">
            AI CostGuard wraps SDK clients and function-style agent steps, estimates cost before execution,
            blocks loops and retry storms, and exposes structured errors your app can handle.
          </p>

          <div className="mx-auto mb-8 max-w-2xl rounded-lg border border-gray-800 bg-gray-900 p-4 font-mono text-sm text-gray-300">
            <span className="text-gray-500">$</span> {installCommand}
          </div>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={copyToClipboard}
              className="rounded-lg bg-red-600 px-8 py-3 font-semibold text-white transition-colors hover:bg-red-700"
            >
              {copied ? 'Copied' : 'Copy Install Command'}
            </button>
            <a
              href="https://github.com/salimassili62-afk/ai-costguard"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-gray-700 px-8 py-3 font-semibold text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
            >
              View Source
            </a>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
          <Feature
            title="Pre-call budget checks"
            body="Estimate input and reserved output cost before the provider method executes."
          />
          <Feature
            title="Agent loop protection"
            body="Detect repeated prompts and retry storms per project, user, or session with TTL-bounded history."
          />
          <Feature
            title="Local visibility"
            body="Use events, JSONL logs, CLI checks, and a localhost dashboard without a cloud backend."
          />
        </div>
      </section>

      <section className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-6 text-3xl font-bold text-white">What it is</h2>
          <div className="grid gap-4 text-gray-300 md:grid-cols-2">
            <p className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              A small npm package for Node.js apps that want runtime guardrails around AI SDK calls and agent steps.
            </p>
            <p className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              A practical safety net for OpenAI, Anthropic, Vercel AI SDK, LangChain-style adapters, demos, CI jobs, and budget-sensitive workflows.
            </p>
          </div>

          <h2 className="mb-6 mt-12 text-3xl font-bold text-white">What it is not</h2>
          <div className="grid gap-4 text-gray-300 md:grid-cols-2">
            <p className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              Not a SaaS control plane, proxy gateway, billing ledger, telemetry system, or auth layer.
            </p>
            <p className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              Not a guarantee that provider billing will match estimates. The dashboard is local-only and file-backed.
            </p>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="mb-6 text-3xl font-bold text-white">Install the guardrail before you need it.</h2>
          <p className="mb-8 text-xl text-gray-400">
            One wrapper, scoped state, function adapters, optional Redis helper, local dashboard, and no hosted dependency.
          </p>
          <button
            onClick={copyToClipboard}
            className="rounded-lg bg-red-600 px-8 py-3 font-semibold text-white transition-colors hover:bg-red-700"
          >
            {copied ? 'Copied' : installCommand}
          </button>
        </div>
      </section>
    </main>
  )
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <h3 className="mb-3 text-lg font-semibold text-white">{title}</h3>
      <p className="text-gray-400">{body}</p>
    </div>
  )
}
