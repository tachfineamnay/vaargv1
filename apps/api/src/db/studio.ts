// Drizzle Studio launcher
import { spawn } from 'child_process';

const child = spawn('npx', ['drizzle-kit', 'studio'], {
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
