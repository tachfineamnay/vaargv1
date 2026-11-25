'use client';

import { useState, useEffect } from 'react';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptimeSeconds: number;
  checks: Record<string, { status: 'pass' | 'warn' | 'fail'; component: string }>;
}

export function HomeContent() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) throw new Error('Health check failed');
        const data = await res.json();
        setHealth(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-gray-900 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading VAARG...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center p-8">
          <svg
            className="mx-auto h-16 w-16 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-gray-50">
            Unable to connect
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">{error}</p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-500">
            Check that the API service is running on port 4000
          </p>
        </div>
      </div>
    );
  }

  const statusColors = {
    healthy: 'text-green-600 dark:text-green-400',
    degraded: 'text-yellow-600 dark:text-yellow-400',
    unhealthy: 'text-red-600 dark:text-red-400',
  };

  const statusBgColors = {
    healthy: 'bg-green-100 dark:bg-green-900/30',
    degraded: 'bg-yellow-100 dark:bg-yellow-900/30',
    unhealthy: 'bg-red-100 dark:bg-red-900/30',
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Hero / Bento Grid */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 py-20">
        <div className="max-w-7xl w-full">
          <div className="text-center mb-16">
            <h1 className="text-5xl md:text-7xl font-serif font-bold tracking-tight text-gray-900 dark:text-gray-50 mb-6">
              Adaptive Commerce
            </h1>
            <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
              A production-grade headless storefront that learns, adapts, and remembers. Powered by
              Shopify, orchestrated by Hermes.
            </p>
          </div>

          {/* Bento Grid - Product Families */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
            {[
              {
                title: 'Apparel',
                subtitle: 'Curated collections',
                icon: '👔',
                href: '/shop/apparel',
              },
              {
                title: 'Accessories',
                subtitle: 'Finishing touches',
                icon: '👝',
                href: '/shop/accessories',
              },
              { title: 'Home', subtitle: 'Living essentials', icon: '🏠', href: '/shop/home' },
              { title: 'Gifts', subtitle: 'Personalized', icon: '🎁', href: '/shop/gifts' },
            ].map((item) => (
              <a
                key={item.title}
                href={item.href}
                className="group relative p-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-300 overflow-hidden"
              >
                <div className="text-4xl mb-3">{item.icon}</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50 group-hover:text-gray-700 dark:group-hover:text-gray-300">
                  {item.title}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{item.subtitle}</p>
                <div className="absolute inset-0 bg-gradient-to-t from-gray-900/0 to-gray-900/5 group-hover:from-gray-900/10 transition-opacity" />
              </a>
            ))}
          </div>

          {/* System Status */}
          {health && (
            <div className="mt-16 p-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                  System Health
                </h2>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${statusBgColors[health.status]} ${statusColors[health.status]}`}
                >
                  {health.status.toUpperCase()}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Uptime</p>
                  <p className="font-mono text-gray-900 dark:text-gray-50">
                    {Math.floor(health.uptimeSeconds / 60)}m {health.uptimeSeconds % 60}s
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Last Check</p>
                  <p className="font-mono text-gray-900 dark:text-gray-50">
                    {new Date(health.timestamp).toLocaleTimeString()}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Services</p>
                  <p className="font-mono text-gray-900 dark:text-gray-50">
                    {Object.values(health.checks).filter((c) => c.status === 'pass').length} /{' '}
                    {Object.keys(health.checks).length}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Environment</p>
                  <p className="font-mono text-gray-900 dark:text-gray-50">Development</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
