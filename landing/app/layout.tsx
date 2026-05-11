import './globals.css'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'AI CostGuard - AI Runtime Kill Switch',
  description: 'The emergency kill switch for runaway AI spending. Stop infinite loops, retry storms, and cost explosions in seconds.',
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
