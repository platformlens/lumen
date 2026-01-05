
const pty = require('node-pty');
const os = require('os');

console.log('Platform:', os.platform());
console.log('Arch:', os.arch());
const shell = process.env['SHELL'] || '/bin/bash';

try {
    const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME,
        env: process.env
    });

    console.log('PTY spawned PID:', ptyProcess.pid);
    ptyProcess.kill();
    console.log('PTY killed - SUCCESS');
} catch (e) {
    console.error('Error spawning PTY:', e);
    process.exit(1);
}
