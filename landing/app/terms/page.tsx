'use client'

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <section className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-4 text-2xl font-bold text-white">License and Disclaimer</h1>

          <p className="mb-4 text-sm text-gray-400">
            AI CostGuard is free and MIT licensed. There is no purchase, no subscription, no account,
            and no feature gate. The full license text is in the{' '}
            <a
              href="https://github.com/salimassili62-afk/ai-costguard/blob/main/LICENSE"
              className="underline"
            >
              LICENSE file
            </a>{' '}
            in the repository.
          </p>

          <h2 className="mt-4 mb-2 text-lg font-semibold text-white">License</h2>
          <p className="mb-4 text-sm text-gray-300">
            The software is licensed for personal and commercial use, including modification and
            redistribution under the MIT terms. There is no separate paid tier, and no part of the
            software is withheld behind a license key or activation step.
          </p>

          <h2 className="mt-4 mb-2 text-lg font-semibold text-white">No Warranty</h2>
          <p className="mb-4 text-sm text-gray-300">
            The software is provided &ldquo;as-is&rdquo; without warranties of any kind. It is a
            cost guardrail, not a billing system: it enforces a budget you configure against a
            pre-call estimate, and it makes no guarantee of cost savings. The authors are not liable
            for financial losses arising from its use or non-use.
          </p>

          <h2 className="mt-4 mb-2 text-lg font-semibold text-white">Telemetry</h2>
          <p className="mb-4 text-sm text-gray-300">
            The library collects nothing. There is no analytics, no crash reporting, no phone-home,
            and no network request of any kind unless you configure a webhook URL yourself.
          </p>

          <h2 className="mt-4 mb-2 text-lg font-semibold text-white">Security Reports</h2>
          <p className="mb-4 text-sm text-gray-300">
            Please report vulnerabilities privately rather than in a public issue. See the{' '}
            <a
              href="https://github.com/salimassili62-afk/ai-costguard/blob/main/SECURITY.md"
              className="underline"
            >
              SECURITY.md
            </a>{' '}
            file for the current process.
          </p>

          <p className="mb-2 text-sm text-gray-400">Governing law: Tunisia.</p>

          <p className="mb-2 text-sm text-gray-400">
            Questions? Email{' '}
            <a href="mailto:aicostguard9@gmail.com" className="underline">
              aicostguard9@gmail.com
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  )
}
