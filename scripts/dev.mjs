import { spawn } from 'node:child_process';

const children = [
  spawn('npm', ['run', 'dev', '-w', '@zdj/engine'], { stdio: 'inherit', shell: true }),
  spawn('npm', ['run', 'dev', '-w', '@zdj/dashboard'], { stdio: 'inherit', shell: true }),
];

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', code => {
  if (code && code !== 0) process.exitCode = code;
});
