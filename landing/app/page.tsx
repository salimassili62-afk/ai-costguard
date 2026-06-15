'use client'

import { useState } from 'react'

const installCommand = 'npm install @salimassili/ai-costguard'
const PRO_CHECKOUT_URL =
  'https://aicostguard.lemonsqueezy.com/checkout/buy/b79ebf12-0afa-46d3-bbf5-e57b6f7f2238'
const GITHUB_URL = 'https://github.com/salimassili62-afk/ai-costguard'
const NPM_URL = 'https://www.npmjs.com/package/@salimassili/ai-costguard'

const freeFeatures = [
  'Local-first npm package',
  'Process-local Node.js protection',
  'Budget, loop, retry, and max-step guards',
  'Unknown-model pricing protection',
  'CLI checks and local logs',
]

const proFeatures = [
  'Redis/shared-budget setup guide',
  'Cross-process budget examples',
  'CI budget gate guide and script',
  'Production deployment guidance',
  'Troubleshooting and launch checklists',
]

const proIncludes = [
  'README and Free vs Pro positioning',
  'Redis Docker Compose starter',
  'Express production example',
  'Vercel AI production adapter example',
  'Security, limits, and failure-mode notes',
]

const limits = [
  'No hosted backend or cloud control plane.',
  'No private npm package.',
  'No runtime license enforcement.',
  'Not enterprise security software or a hard security boundary.',
  'Cost estimates are guardrails, not provider invoice reconciliation.',
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
            Stop runaway AI-agent costs before API calls execute.
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-gray-400">
            AI CostGuard is a Node.js runtime safety layer for AI agents. Use the free npm package for
            process-local protection, then add Pro when production needs Redis/shared budgets and deployment
            playbooks.
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
              id="buy-pro-hero-btn"
              href={PRO_CHECKOUT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-orange-600 px-7 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
            >
              Buy Pro - TND60/month
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
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-8 text-center text-2xl font-bold text-white">Free vs Pro</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <PlanCard title="Free" subtitle="MIT npm package" items={freeFeatures} ctaHref={NPM_URL} ctaText="View on npm" />
            <PlanCard
              title="Pro"
              subtitle="TND60/month production bundle"
              items={proFeatures}
              ctaHref={PRO_CHECKOUT_URL}
              ctaText="Buy Pro"
              highlight
            />
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-6 text-center text-2xl font-bold text-white">What Pro Includes</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {proIncludes.map((item) => (
              <CheckRow key={item} text={item} />
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-6 text-center text-2xl font-bold text-white">Honest Limits</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {limits.map((item) => (
              <div key={item} className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-300">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-2xl rounded-lg border border-orange-800/40 bg-orange-950/20 p-8 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-orange-400">
            Production setup bundle
          </p>
          <h2 className="mb-3 text-2xl font-bold text-white">Ready for shared production budgets?</h2>
          <p className="mb-6 text-sm leading-relaxed text-gray-400">
            Get the Redis setup, cross-process examples, CI budget gate, deployment guidance, troubleshooting
            notes, and checklists in one copyable bundle.
          </p>
          <a
            id="buy-pro-final-btn"
            href={PRO_CHECKOUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg bg-orange-600 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
          >
            Buy Pro - TND60/month
          </a>
        </div>
      </section>
    </main>
  )
}

function PlanCard({
  title,
  subtitle,
  items,
  ctaHref,
  ctaText,
  highlight = false,
}: {
  title: string
  subtitle: string
  items: string[]
  ctaHref: string
  ctaText: string
  highlight?: boolean
}) {
  return (
    <div className={`rounded-lg border bg-gray-900 p-6 ${highlight ? 'border-orange-700/60' : 'border-gray-800'}`}>
      <div className="mb-5">
        <h3 className="text-lg font-bold text-white">{title}</h3>
        <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <CheckRow key={item} text={item} />
        ))}
      </ul>
      <a
        href={ctaHref}
        target="_blank"
        rel="noopener noreferrer"
        className={`mt-6 block rounded-lg px-5 py-2.5 text-center text-sm font-semibold transition-colors ${
          highlight
            ? 'bg-orange-600 text-white hover:bg-orange-700'
            : 'border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white'
        }`}
      >
        {ctaText}
      </a>
    </div>
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
