import './globals.css'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'AI CostGuard - Runtime safety for AI agents',
  description: 'Local-first runtime safety layer for AI agents that blocks runaway costs, loops, retries, and budget overruns before API calls execute.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="bg-gray-950 text-gray-100">
      <body className={inter.className}>
        {children}
      </body>
    </html>
  )
}
