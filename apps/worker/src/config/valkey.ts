import Redis from 'ioredis';
import { config } from './env';

export function createValkeyConnection(): Redis {
  const client = new Redis(config.VALKEY_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 3) return null;
      return Math.min(times * 1000, 5000);
    },
    lazyConnect: true,
    enableReadyCheck: true,
    maxLoadingRetryTime: 10000,
  });

  client.on('error', (err) => {
    console.error('Valkey connection error:', err);
  });

  client.on('connect', () => {
    console.log('Valkey connected');
  });

  client.on('ready', () => {
    console.log('Valkey ready');
  });

  return client;
}
