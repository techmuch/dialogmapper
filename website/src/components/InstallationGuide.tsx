import React, { useState } from 'react';
import { Terminal, Download, Cpu, Check, Copy } from 'lucide-react';

export const InstallationGuide: React.FC = () => {
  const [installType, setInstallType] = useState<'go' | 'source' | 'binary'>('go');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyCode = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <section id="install" style={{ padding: '5rem 0', background: 'var(--bg-dark)' }}>
      <div className="container">
        
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <span style={{ color: 'var(--accent-cyan)', fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Installation & Setup
          </span>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 800, marginTop: '0.5rem', marginBottom: '0.75rem' }}>
            Get Up and Running in Under 2 Minutes
          </h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '650px', margin: '0 auto' }}>
            No background database services, no complex dependencies. Choose your preferred installation method below.
          </p>
        </div>

        {/* Installation Method Selector */}
        <div className="tabs-nav" style={{ justifyContent: 'center', maxWidth: '600px', margin: '0 auto 2.5rem auto' }}>
          <button
            onClick={() => setInstallType('go')}
            className={`tab-btn ${installType === 'go' ? 'active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <Terminal style={{ width: '1rem', height: '1rem' }} />
            <span>Go Install (Recommended)</span>
          </button>

          <button
            onClick={() => setInstallType('binary')}
            className={`tab-btn ${installType === 'binary' ? 'active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <Download style={{ width: '1rem', height: '1rem' }} />
            <span>Pre-built Binaries</span>
          </button>

          <button
            onClick={() => setInstallType('source')}
            className={`tab-btn ${installType === 'source' ? 'active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <Cpu style={{ width: '1rem', height: '1rem' }} />
            <span>From Source</span>
          </button>
        </div>

        {/* Tab 1: Go Install */}
        {installType === 'go' && (
          <div className="card" style={{ maxWidth: '800px', margin: '0 auto', background: 'var(--bg-card)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Terminal style={{ color: 'var(--accent-cyan)' }} />
              <span>Install via Go Toolchain</span>
            </h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Requires Go 1.25+. Compiles the single executable and places it directly into your <code>$GOPATH/bin</code> or <code>$HOME/go/bin</code>.
            </p>

            <div className="code-block" style={{ marginBottom: '1rem' }}>
              <code>go install github.com/techmuch/dialogmapper@latest</code>
              <button
                onClick={() => copyCode('go install github.com/techmuch/dialogmapper@latest', 1)}
                className="code-copy-btn"
              >
                {copiedIndex === 1 ? <Check style={{ width: '0.9rem', height: '0.9rem', color: '#34d399' }} /> : <Copy style={{ width: '0.9rem', height: '0.9rem' }} />}
                <span>{copiedIndex === 1 ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Pre-built Binaries */}
        {installType === 'binary' && (
          <div className="card" style={{ maxWidth: '850px', margin: '0 auto', background: 'var(--bg-card)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Download style={{ color: 'var(--accent-cyan)' }} />
              <span>Download Standalone Binary (v0.0.16)</span>
            </h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              No Go or Node install required on target machines. Download the binary for your operating system:
            </p>

            <div className="grid-3">
              <a
                href="https://github.com/techmuch/dialogmapper/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="card"
                style={{ background: '#0a0e1a', textDecoration: 'none', textAlign: 'center', padding: '1.25rem' }}
              >
                <div style={{ fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>macOS (Apple Silicon & Intel)</div>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>darwin/arm64, darwin/amd64</span>
              </a>

              <a
                href="https://github.com/techmuch/dialogmapper/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="card"
                style={{ background: '#0a0e1a', textDecoration: 'none', textAlign: 'center', padding: '1.25rem' }}
              >
                <div style={{ fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>Linux</div>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>linux/amd64, linux/arm64</span>
              </a>

              <a
                href="https://github.com/techmuch/dialogmapper/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="card"
                style={{ background: '#0a0e1a', textDecoration: 'none', textAlign: 'center', padding: '1.25rem' }}
              >
                <div style={{ fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>Windows</div>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>windows/amd64.exe</span>
              </a>
            </div>
          </div>
        )}

        {/* Tab 3: Build from Source */}
        {installType === 'source' && (
          <div className="card" style={{ maxWidth: '800px', margin: '0 auto', background: 'var(--bg-card)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Cpu style={{ color: 'var(--accent-cyan)' }} />
              <span>Build From Source Repository</span>
            </h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Clone the repository, compile the React SPA into <code>internal/web/dist</code>, and build the single binary.
            </p>

            <div className="code-block" style={{ marginBottom: '1rem' }}>
              <pre>{`git clone https://github.com/techmuch/dialogmapper.git
cd dialogmapper
make build
make install`}</pre>
            </div>
          </div>
        )}

        {/* Quickstart Workflow Cards */}
        <div style={{ marginTop: '4rem' }}>
          <h3 style={{ fontSize: '1.5rem', fontWeight: 700, textAlign: 'center', marginBottom: '2rem' }}>
            Quickstart Workflow
          </h3>

          <div className="grid-3">
            <div className="card" style={{ background: '#0a0e1a' }}>
              <div style={{ background: 'rgba(56, 189, 248, 0.1)', color: 'var(--accent-cyan)', width: '2rem', height: '2rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, marginBottom: '1rem' }}>1</div>
              <h4 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Initialize Directory</h4>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Scaffolds <code>maps.db</code>, <code>.assets/</code> directory, and starter documentation.
              </p>
              <div className="code-block" style={{ fontSize: '0.8125rem', padding: '0.6rem 0.8rem' }}>
                <code>dialogmapper init</code>
              </div>
            </div>

            <div className="card" style={{ background: '#0a0e1a' }}>
              <div style={{ background: 'rgba(129, 140, 248, 0.1)', color: 'var(--ibis-idea)', width: '2rem', height: '2rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, marginBottom: '1rem' }}>2</div>
              <h4 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Start Local Server & UI</h4>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Serves at <code>:7373</code> and opens your browser at <code>127.0.0.1</code>. Binds every interface by default and prints a QR for phones, gated by a per-run key.
              </p>
              <div className="code-block" style={{ fontSize: '0.8125rem', padding: '0.6rem 0.8rem' }}>
                <code>dialogmapper start --open</code>
              </div>
            </div>

            <div className="card" style={{ background: '#0a0e1a' }}>
              <div style={{ background: 'rgba(52, 211, 153, 0.1)', color: 'var(--ibis-pro)', width: '2rem', height: '2rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, marginBottom: '1rem' }}>3</div>
              <h4 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Seed from Research</h4>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Converts raw markdown notes into structured IBIS scaffolding automatically.
              </p>
              <div className="code-block" style={{ fontSize: '0.8125rem', padding: '0.6rem 0.8rem' }}>
                <code>dialogmapper seed --context notes.md</code>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
};
