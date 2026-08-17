import React from 'react';
import { Network } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer style={{ background: '#050810', borderTop: '1px solid var(--border-color)', padding: '3rem 0 2rem 0' }}>
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Network style={{ width: '1.25rem', height: '1.25rem', color: 'var(--accent-cyan)' }} />
            <span style={{ fontWeight: 700, fontSize: '1.1rem', color: '#fff' }}>dialogmapper</span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>v0.0.14 • MIT License</span>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem' }}>
            <a href="https://github.com/techmuch/dialogmapper" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>GitHub Repo</a>
            <a href="https://github.com/techmuch/dialogmapper/releases" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Releases</a>
            <a href="#features" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Features</a>
            <a href="#install" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Installation</a>
            <a href="#cli" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>CLI Reference</a>
          </div>
        </div>

        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '1.5rem', textAlign: 'center', fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
          Built for modeling wicked problems with IBIS graph trees. Single binary Go server + SQLite + Embedded React SPA.
        </div>
      </div>
    </footer>
  );
};
