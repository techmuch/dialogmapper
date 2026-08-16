import React, { useState } from 'react';
import { Terminal, Copy, Check, Sparkles, ShieldCheck, Zap, Cpu, Database } from 'lucide-react';

export const Hero: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const installCmd = 'go install github.com/techmuch/dialogmapper@latest';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="bg-radial-glow" style={{ padding: '5rem 0 3.5rem 0' }}>
      <div className="container" style={{ textAlign: 'center' }}>
        
        {/* Top pill badge */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.35rem 0.85rem',
          borderRadius: '2rem',
          background: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          color: 'var(--accent-cyan)',
          fontSize: '0.875rem',
          fontWeight: 600,
          marginBottom: '1.5rem'
        }}>
          <Sparkles style={{ width: '1rem', height: '1rem' }} />
          <span>Local-First IBIS Dialog Mapping Environment</span>
        </div>

        {/* Hero Title */}
        <h1 style={{
          fontSize: 'clamp(2.25rem, 5vw, 4rem)',
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacing: '-0.03em',
          maxWidth: '900px',
          margin: '0 auto 1.25rem auto',
          background: 'linear-gradient(180deg, #FFFFFF 30%, #94A3B8 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          Model Wicked Problems into Enforced IBIS Decision Trees
        </h1>

        {/* Subtitle */}
        <p style={{
          fontSize: '1.1875rem',
          color: 'var(--text-muted)',
          maxWidth: '740px',
          margin: '0 auto 2.5rem auto',
          lineHeight: 1.6
        }}>
          A single-binary Go server, SQLite graph store, and embedded React canvas built for facilitators capturing rapid conversation. Strict edge validation, transclusion, auto-layout, and AI agent integration out of the box.
        </p>

        {/* One-click install command box */}
        <div style={{
          maxWidth: '620px',
          margin: '0 auto 3rem auto',
          background: '#060911',
          border: '1px solid var(--border-color)',
          borderRadius: '0.75rem',
          padding: '0.75rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
            <Terminal style={{ color: 'var(--accent-cyan)', width: '1.2rem', height: '1.2rem', flexShrink: 0 }} />
            <code style={{ fontSize: '0.9375rem', color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {installCmd}
            </code>
          </div>
          <button
            onClick={copyToClipboard}
            className="btn-secondary"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8125rem', flexShrink: 0 }}
          >
            {copied ? <Check style={{ width: '1rem', height: '1rem', color: '#34d399' }} /> : <Copy style={{ width: '1rem', height: '1rem' }} />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
        </div>

        {/* Core Pillars / Badges */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '1.5rem',
          color: 'var(--text-muted)',
          fontSize: '0.9375rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Cpu style={{ width: '1.1rem', height: '1.1rem', color: 'var(--accent-cyan)' }} />
            <span>Single Self-Contained Executable</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Database style={{ width: '1.1rem', height: '1.1rem', color: 'var(--ibis-idea)' }} />
            <span>Pure Go SQLite Graph (cgo-free)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldCheck style={{ width: '1.1rem', height: '1.1rem', color: 'var(--ibis-pro)' }} />
            <span>Strict IBIS Edge Validation</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Zap style={{ width: '1.1rem', height: '1.1rem', color: 'var(--ibis-note)' }} />
            <span>Zero-Mouse Capture Loop</span>
          </div>
        </div>

      </div>
    </section>
  );
};
