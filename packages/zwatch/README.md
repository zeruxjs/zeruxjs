> [!WARNING]
> This package is in a very early stage of development and is only published for pre-saving the name from being taken by somebody else. All current versions follow the `0.0.1-alpha.x` pattern.

# zwatch


A high-performance, intelligent file change watcher designed for the ZeruxJS ecosystem. `zwatch` optimizes resource usage by sharing file system events across multiple processes using a local daemon.

## Features

- **Shared Daemon Architecture**: Uses a local IPC socket to broadcast events, ensuring only one system-level watcher runs per project root.
- **Automatic Takeover**: If the master watcher daemon dies, another process automatically takes over supervision.
- **Debounced Events**: Intelligent event deduplication and debouncing (50ms) to prevent "double-fire" triggers.
- **Cross-Platform**: Optimized for both Windows (Named Pipes) and Unix-like (Unix Sockets) systems.
- **Event Types**: Detects and classifies changes as `new`, `update`, or `delete`.

## Installation

```bash
npm install zwatch
```

## Usage

```typescript
import { startWatcher } from 'zwatch';

const stop = startWatcher(process.cwd(), (event, type) => {
    console.log(`File: ${event.file}`);
    console.log(`Event Type: ${type}`); // 'new', 'update', or 'delete'
});

// To stop watching later:
// stop();
```

## How it Works

1. **Connection**: When `startWatcher` is called, it attempts to connect to a local socket file in `/tmp` (or a Named Pipe on Windows).
2. **Master/Slave**: If a daemon is already running, the process becomes a "listener" and receives events via IPC.
3. **Supervision**: If no daemon is found, the current process spawns a master daemon that watches the file system using `fs.watch` and broadcasts events to all connected clients.
4. **Resilience**: The system is designed to be extremely resilient; if the process holding the master daemon exits, remaining "listener" processes will negotiate and one will take over as the new master.

---

<p align="center">
  Built with ❤️ for the ZeruxJS Framework.
</p>
