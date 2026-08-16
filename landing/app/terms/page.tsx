'use client'

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <section className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-4 text-2xl font-bold text-white">Terms of Service</h1>

          <p className="mb-4 text-sm text-gray-400">
            By purchasing AI CostGuard Pro, you agree to these terms. The
            purchase is a one-time fee for the distributed kit. Refunds are not
            provided after download.
          </p>

          <h2 className="mt-4 mb-2 text-lg font-semibold text-white">License</h2>
          <p className="mb-4 text-sm text-gray-300">
            The software is licensed for personal and commercial use. You may
            use it to run and protect your own projects. You may not resell or
            redistribute the kit itself as a product for resale.
          </p>

          <h2 className="mt-4 mb-2 text-lg font-semibold text-white">Warranty Disclaimer</h2>
          <p className="mb-4 text-sm text-gray-300">
            The software is provided "as-is" without warranties or guarantees.
            While it aims to help control API usage costs, there is no
            guaranteed cost savings and the authors are not liable for
            financial losses.
          </p>

          <p className="mb-2 text-sm text-gray-400">Governing law: Tunisia.</p>

          <p className="mb-2 text-sm text-gray-400">
            Questions? Email <a href="mailto:aicostguard9@gmail.com" className="underline">aicostguard9@gmail.com</a>.
          </p>
        </div>
      </section>
    </main>
  )
}
