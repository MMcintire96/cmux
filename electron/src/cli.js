#!/usr/bin/env node
// cmux CLI - communicate with running cmux instance via Unix socket

const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SOCKET_INFO_PATH = path.join(os.tmpdir(), 'cmux-socket-path');

function getSocketPath() {
  try {
    return fs.readFileSync(SOCKET_INFO_PATH, 'utf8').trim();
  } catch {
    console.error('cmux is not running (no socket found)');
    process.exit(1);
  }
}

function sendCommand(command) {
  return new Promise((resolve, reject) => {
    const socketPath = getSocketPath();
    const client = net.createConnection(socketPath, () => {
      client.write(command + '\n');
    });

    let response = '';
    client.on('data', (data) => {
      response += data.toString();
      try {
        const parsed = JSON.parse(response.trim());
        client.end();
        resolve(parsed);
      } catch {}
    });

    client.on('error', (err) => {
      reject(new Error(`Failed to connect to cmux: ${err.message}`));
    });

    client.on('end', () => {
      try {
        resolve(JSON.parse(response.trim()));
      } catch {
        resolve({ raw: response.trim() });
      }
    });

    setTimeout(() => {
      client.end();
      reject(new Error('Command timed out'));
    }, 5000);
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`cmux CLI

Usage:
  cmux <command> [args...]

Commands:
  workspace.list              List all workspaces
  workspace.new [name]        Create a new workspace
  workspace.select <index>    Select workspace by index
  workspace.close [index]     Close workspace
  pane.split <direction>      Split pane (horizontal|vertical)
  notification.list           List notifications
  notification.send <title> [body]  Send a notification

Examples:
  cmux workspace.new my-project
  cmux notification.send "Build Done" "All tests passed"
`);
    return;
  }

  const command = args.join(' ');

  try {
    const result = await sendCommand(command);
    if (result.error) {
      console.error('Error:', result.error);
      process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
