'use client'

import { useState } from 'react'

export default function Home() {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    navigator.clipboard.writeText('npm install @salimassili/ai-costguard')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">
            We stop AI agents when they start burning money.
          </h1>
          
          <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
            Runtime enforcement layer that prevents runaway AI execution before it costs thousands.
          </p>

          <div className="mb-8">
            <div className="terminal max-w-2xl mx-auto">
              <div className="terminal-line">
                <span className="text-gray-500">$</span> npm install @salimassili/ai-costguard
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <button
              onClick={copyToClipboard}
              className="px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors"
            >
              {copied ? 'Copied!' : 'Install Kill Switch'}
            </button>
            
            <a
              href="https://github.com/salimassili62-afk/ai-costguard"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white font-semibold rounded-lg transition-colors"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </div>

      {/* Differentiation Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-8">
            Not a logger. Not a middleware.
          </h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="text-2xl mb-4 text-red-500">❌</div>
              <h3 className="text-lg font-semibold text-white mb-2">Not Analytics</h3>
              <p className="text-gray-400">
                We don't track metrics or show dashboards.
              </p>
            </div>
            
            <div className="text-center">
              <div className="text-2xl mb-4 text-red-500">❌</div>
              <h3 className="text-lg font-semibold text-white mb-2">Not Monitoring</h3>
              <p className="text-gray-400">
                We don't observe or report on AI behavior.
              </p>
            </div>
            
            <div className="text-center">
              <div className="text-2xl mb-4 text-green-500">✓</div>
              <h3 className="text-lg font-semibold text-white mb-2">Runtime Enforcement</h3>
              <p className="text-gray-400">
                We stop execution before it becomes a disaster.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Problem Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-8 text-center">
            Problem
          </h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="text-3xl mb-4">🔄</div>
              <h3 className="text-lg font-semibold text-white mb-2">Uncontrolled Execution</h3>
              <p className="text-gray-400">
                AI agents run uncontrolled in production with no visibility.
              </p>
            </div>
            
            <div className="text-center">
              <div className="text-3xl mb-4">📈</div>
              <h3 className="text-lg font-semibold text-white mb-2">Silent Cost Growth</h3>
              <p className="text-gray-400">
                Costs grow silently until bill arrives.
              </p>
            </div>
            
            <div className="text-center">
              <div className="text-3xl mb-4">👁️</div>
              <h3 className="text-lg font-semibold text-white mb-2">Invisible Loops</h3>
              <p className="text-gray-400">
                Infinite loops and retry storms are invisible until too late.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Consequence Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-8 text-center">
            Consequence
          </h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="text-3xl mb-4">💸</div>
              <h3 className="text-lg font-semibold text-white mb-2">Thousands Lost</h3>
              <p className="text-gray-400">
                Companies lose $1,000-$10,000 in minutes.
              </p>
            </div>
            
            <div className="text-center">
              <div className="text-3xl mb-4">🚨</div>
              <h3 className="text-lg font-semibold text-white mb-2">No Alerts</h3>
              <p className="text-gray-400">
                No real-time alerts until billing arrives.
              </p>
            </div>
            
            <div className="text-center">
              <div className="text-3xl mb-4">⚡</div>
              <h3 className="text-lg font-semibold text-white mb-2">Execution Storms</h3>
              <p className="text-gray-400">
                No visibility into cascading execution failures.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Solution Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-6">
            Solution
          </h2>
          
          <p className="text-xl text-gray-400 mb-12 max-w-2xl mx-auto">
            AI CostGuard acts as runtime kill switch that stops runaway execution before cost explosion.
          </p>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="text-2xl mb-4 text-green-500">✓</div>
              <h3 className="text-lg font-semibold text-white mb-2">Loop Detection</h3>
              <p className="text-gray-400">
                Detects repetitive patterns and kills infinite loops instantly.
              </p>
            </div>
            
            <div className="text-center">
              <div className="text-2xl mb-4 text-green-500">✓</div>
              <h3 className="text-lg font-semibold text-white mb-2">Retry Storm Detection</h3>
              <p className="text-gray-400">
                Identifies cascading retry patterns and stops them before they explode.
              </p>
            </div>
            
            <div className="text-center">
              <div className="text-2xl mb-4 text-green-500">✓</div>
              <h3 className="text-lg font-semibold text-white mb-2">Budget Kill Switch</h3>
              <p className="text-gray-400">
                Hard budget limits with instant emergency shutdown.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Proof Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-8 text-center">
            Production Impact
          </h2>
          
          <div className="text-center mb-12">
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Has prevented runaway AI loops from costing $1,000–$10,000+ in production environments (early adopters / internal use cases).
            </p>
          </div>
          
          <div className="terminal max-w-2xl mx-auto">
            <div className="terminal-line">
              <span className="text-gray-500">$</span> npm run ai-agent
            </div>
            <div className="terminal-line">
              Processing user feedback...
            </div>
            <div className="terminal-line">
              Processing user feedback...
            </div>
            <div className="terminal-line">
              Processing user feedback...
            </div>
            <div className="terminal-line text-gray-500">
              retry (error: timeout)
            </div>
            <div className="terminal-line text-gray-500">
              retry (error: timeout)
            </div>
            <div className="terminal-line text-gray-500">
              retry (error: timeout)
            </div>
            <div className="terminal-error">
              🚨 RETRY STORM DETECTED
            </div>
            <div className="terminal-success">
              🛑 KILL SWITCH ACTIVATED → saved $1,247.83
            </div>
          </div>
        </div>
      </div>

      {/* Social Proof Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="text-2xl mb-4">🚀</div>
              <h3 className="text-lg font-semibold text-white mb-2">Production Ready</h3>
              <p className="text-gray-400">
                Used in production AI agents handling millions of requests.
              </p>
            </div>
            
            <div className="text-center">
              <div className="text-2xl mb-4">🛡️</div>
              <h3 className="text-lg font-semibold text-white mb-2">Prevents Disasters</h3>
              <p className="text-gray-400">
                Stops runaway LLM execution before it becomes a problem.
              </p>
            </div>
            
            <div className="text-center">
              <div className="text-2xl mb-4">⚡</div>
              <h3 className="text-lg font-semibold text-white mb-2">Built for Startups</h3>
              <p className="text-gray-400">
                Designed for AI startups shipping agents to production.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Final CTA Section */}
      <div className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-6">
            Stop runaway AI costs today
          </h2>
          
          <p className="text-xl text-gray-400 mb-8">
            Install the kill switch before your AI agent creates a surprise bill.
          </p>

          <div className="mb-8">
            <div className="terminal max-w-2xl mx-auto">
              <div className="terminal-line">
                <span className="text-gray-500">$</span> npm install @salimassili/ai-costguard
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <button
              onClick={copyToClipboard}
              className="px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors"
            >
              {copied ? 'Copied!' : 'Protect Your AI Now'}
            </button>
            
            <a
              href="https://github.com/salimassili62-afk/ai-costguard"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white font-semibold rounded-lg transition-colors"
            >
              Star on GitHub
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
