'use client'

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <section className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-4 text-2xl font-bold text-white">Privacy Policy</h1>

          <p className="mb-4 text-sm text-gray-400">
            AI CostGuard is a local-first tool and does not collect or transmit
            any user data. There is no tracking, analytics, or remote profiling
            tied to the package or this site.
          </p>

          <ul className="mb-4 list-disc pl-5 text-sm text-gray-300">
            <li>No data is collected by AI CostGuard.</li>
            <li>No account, no login, and no data storage is required.</li>
            <li>The npm package runs locally on your machine; provider calls are
              executed by you and not logged by this project.</li>
          </ul>

          <p className="mb-2 text-sm text-gray-400">
            If you have privacy questions or need to contact us, email{' '}
            <a href="mailto:aicostguard9@gmail.com" className="underline">aicostguard9@gmail.com</a>.
          </p>
        </div>
      </section>
    </main>
  )
}
