'use client';

import { useState } from 'react';
import styles from './page.module.css';

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockCode, setBlockCode] = useState<string | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResponse('');
    setBlockCode(null);
    setEstimatedCost(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 403) {
          setError(data.reason || 'Blocked by AI CostGuard');
          setBlockCode(data.code || 'BLOCKED');
          setEstimatedCost(data.context?.estimatedCost ?? null);
        } else {
          setError(data.error || 'Request failed');
        }
      } else {
        setResponse(data.text);
      }
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>AI Chat with Cost Protection</h1>
        <p className={styles.subtitle}>Powered by AI CostGuard</p>

        <div className={styles.info}>
          <div className={styles.badge}>Protected</div>
          <div className={styles.badge}>$50 process budget</div>
          <div className={styles.badge}>Local-first</div>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Enter your prompt. Send the same prompt three times to see loop detection."
            className={styles.textarea}
            rows={4}
          />

          <button type="submit" disabled={loading || !prompt.trim()} className={styles.button}>
            {loading ? 'Generating...' : 'Generate Response'}
          </button>
        </form>

        {blockCode && (
          <div className={`${styles.riskBadge} ${styles.medium}`}>
            Block code: {blockCode}
            {estimatedCost !== null ? `, estimated cost $${estimatedCost.toFixed(6)}` : ''}
          </div>
        )}

        {error && (
          <div className={styles.error}>
            <strong>Blocked:</strong> {error}
          </div>
        )}

        {response && (
          <div className={styles.response}>
            <h3 className={styles.responseTitle}>Response:</h3>
            <p className={styles.responseText}>{response}</p>
          </div>
        )}

        <div className={styles.footer}>
          <p>Budget overruns and repeated prompts are blocked before the provider call.</p>
        </div>
      </div>
    </main>
  );
}
