import React, { Component } from 'react';
import { createRoot } from 'react-dom/client';
import Collective from './Collective.jsx';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('App runtime error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'system-ui, sans-serif',
          background: '#f7f5ef',
          color: '#292d27',
          textAlign: 'center'
        }}>
          <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Something went wrong</h2>
          <p style={{ color: '#686d62', fontSize: '14px', maxWidth: '360px', marginBottom: '20px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => { sessionStorage.clear(); location.reload(); }}
            style={{
              padding: '10px 20px',
              borderRadius: '12px',
              border: 'none',
              background: '#3e5930',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <Collective/>
  </ErrorBoundary>
);
