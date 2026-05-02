'use client';

import { useState } from 'react';
import styles from './page.module.css';

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [risk, setRisk] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResponse('');
    setSaved(null);
    setRisk(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 403 && data.saved) {
          // Firewall blocked the request
          setError(data.reason || 'Blocked by AI Firewall');
          setSaved(data.saved);
          setRisk(data.dangerScore > 70 ? 'HIGH' : 'MEDIUM');
        } else {
          setError(data.error || 'Request failed');
        }
      } else {
        setResponse(data.text);
      }
    } catch (err: any) {
      setError('Network error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>
          🤖 AI Chat with Cost Protection
        </h1>
        
        <p className={styles.subtitle}>
          Powered by AI Execution Firewall
        </p>

        <div className={styles.info}>
          <div className={styles.badge}>Protected</div>
          <div className={styles.badge}>$50 Daily Budget</div>
          <div className={styles.badge}>Risk Threshold: 50</div>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter your prompt here... (Try sending the same prompt multiple times to see loop detection)"
            className={styles.textarea}
            rows={4}
          />
          
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className={styles.button}
          >
            {loading ? 'Generating...' : 'Generate Response'}
          </button>
        </form>

        {saved !== null && (
          <div className={styles.savings}>
            <div className={styles.savedBadge}>
              💰 SAVED ${saved.toFixed(4)}
            </div>
            <p className={styles.savedText}>
              Request blocked by AI Firewall
            </p>
          </div>
        )}

        {risk && (
          <div className={`${styles.riskBadge} ${styles[risk.toLowerCase()]}`}>
            ⚠️ Risk Level: {risk}
          </div>
        )}

        {error && (
          <div className={styles.error}>
            <strong>🔥 Blocked:</strong> {error}
          </div>
        )}

        {response && (
          <div className={styles.response}>
            <h3 className={styles.responseTitle}>Response:</h3>
            <p className={styles.responseText}>{response}</p>
          </div>
        )}

        <div className={styles.footer}>
          <p>
            This app is protected by AI Execution Firewall.
            High-risk or duplicate requests are automatically blocked.
          </p>
        </div>
      </div>
    </main>
  );
}
