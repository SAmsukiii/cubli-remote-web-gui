import React from 'react';
import CubliSimulator from './CubliSimulator';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the root mounted even if a render-time data shape bug slips through.
    // eslint-disable-next-line no-console
    console.error('Cubli app render error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#050608', color: '#f8fafc', display: 'grid', placeItems: 'center', padding: '2rem' }}>
          <div style={{ maxWidth: 520 }}>
            <h1 style={{ fontSize: '1.4rem', marginBottom: '0.75rem' }}>Cubli Remote Web GUI</h1>
            <p style={{ color: '#cbd5e1', marginBottom: '1rem' }}>
              The app hit a render error while loading. Reload the page after the latest deployment finishes.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, padding: '0.65rem 0.9rem', fontWeight: 700 }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <CubliSimulator />
    </AppErrorBoundary>
  );
}

