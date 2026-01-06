#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'backend', 'server.js');
const child = spawn('node', [serverPath], { stdio: 'inherit' });

child.on('close', (code) => {
  process.exit(code);
});
