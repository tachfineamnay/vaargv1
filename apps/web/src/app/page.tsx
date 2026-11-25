import { Suspense } from 'react';
import Link from 'next/link';
import { HomeContent } from './HomeContent';

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <Link
                href="/"
                className="text-xl font-serif font-bold tracking-tight text-gray-900 dark:text-gray-50"
              >
                VAARG
              </Link>
              <nav className="hidden md:flex items-center gap-6">
                <Link
                  href="/shop"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-50"
                >
                  Shop
                </Link>
                <Link
                  href="/collections"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-50"
                >
                  Collections
                </Link>
                <Link
                  href="/about"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-50"
                >
                  About
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <button className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-50">
                Search
              </button>
              <button className="relative p-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 11V7a2 2 0 00-2-2H6a2 2 0 00-2 2v18a2 2 0 002 2h2"
                  />
                </svg>
                <span className="sr-only">Cart</span>
              </button>
              <button className="p-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
                <span className="sr-only">Account</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col">
        <Suspense
          fallback={<div className="flex-1 flex items-center justify-center">Loading...</div>}
        >
          <HomeContent />
        </Suspense>
      </div>

      <footer className="border-t border-gray-200 dark:border-gray-800 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            VAARG V1 — Industrial Adaptive Commerce
          </p>
        </div>
      </footer>
    </main>
  );
}
