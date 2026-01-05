const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Config
const PORT = process.env.PORT || 3456;
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(process.env.HOME, '.claude', 'projects');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Store connected clients
const clients = new Set();

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('📡 Client connected');
  clients.add(ws);
  
  // Send initial data
  sendInitialData(ws);
  
  ws.on('close', () => {
    console.log('📡 Client disconnected');
    clients.delete(ws);
  });
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleClientMessage(ws, data);
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });
});

// Broadcast to all clients
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Parse JSONL file
function parseJsonlFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    return lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
  } catch (e) {
    console.error('Error parsing JSONL:', filePath, e.message);
    return [];
  }
}

// Get all sessions
function getAllSessions() {
  const sessions = [];
  
  if (!fs.existsSync(CLAUDE_DIR)) {
    console.log('Claude directory not found:', CLAUDE_DIR);
    return sessions;
  }
  
  const projects = fs.readdirSync(CLAUDE_DIR);
  
  for (const project of projects) {
    const projectPath = path.join(CLAUDE_DIR, project);
    if (!fs.statSync(projectPath).isDirectory()) continue;
    
    const files = fs.readdirSync(projectPath);
    
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      
      const filePath = path.join(projectPath, file);
      const stats = fs.statSync(filePath);
      const entries = parseJsonlFile(filePath);
      
      // Extract session info
      const sessionInfo = extractSessionInfo(entries, project, file);
      sessionInfo.filePath = filePath;
      sessionInfo.lastModified = stats.mtime;
      sessionInfo.fileSize = stats.size;
      
      sessions.push(sessionInfo);
    }
  }
  
  // Sort by last modified
  sessions.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
  
  return sessions;
}

// Extract session info from entries
function extractSessionInfo(entries, project, filename) {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let messageCount = 0;
  let toolUses = [];
  let firstUserMessage = '';
  let summary = '';
  let model = '';
  
  for (const entry of entries) {
    // Count tokens
    if (entry.usage) {
      totalInputTokens += entry.usage.input_tokens || 0;
      totalOutputTokens += entry.usage.output_tokens || 0;
    }
    
    // Count messages
    if (entry.type === 'user' || entry.type === 'assistant') {
      messageCount++;
    }
    
    // Get first user message
    if (entry.type === 'user' && !firstUserMessage && entry.message) {
      const msg = typeof entry.message === 'string' 
        ? entry.message 
        : entry.message.content || '';
      firstUserMessage = msg.substring(0, 200);
    }
    
    // Get summary if available
    if (entry.type === 'summary' && entry.summary) {
      summary = entry.summary;
    }
    
    // Track tool uses
    if (entry.type === 'tool_use' || entry.tool) {
      const toolName = entry.tool || entry.name || 'unknown';
      if (!toolUses.includes(toolName)) {
        toolUses.push(toolName);
      }
    }
    
    // Get model
    if (entry.model && !model) {
      model = entry.model;
    }
  }
  
  return {
    id: filename.replace('.jsonl', ''),
    project: decodeProjectName(project),
    projectRaw: project,
    summary: summary || firstUserMessage || 'No summary',
    messageCount,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    toolUses,
    model,
    entryCount: entries.length
  };
}

// Decode project name from path format
function decodeProjectName(encoded) {
  // Claude encodes paths like: -home-user-project becomes /home/user/project
  return encoded.replace(/-/g, '/');
}

// Get session details
function getSessionDetails(projectRaw, sessionId) {
  const filePath = path.join(CLAUDE_DIR, projectRaw, `${sessionId}.jsonl`);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  const entries = parseJsonlFile(filePath);
  
  // Format entries for display
  const messages = entries.map((entry, index) => {
    return {
      index,
      type: entry.type || 'unknown',
      timestamp: entry.timestamp || entry.ts,
      content: formatEntryContent(entry),
      raw: entry
    };
  });
  
  return {
    sessionId,
    project: decodeProjectName(projectRaw),
    messages,
    stats: extractSessionInfo(entries, projectRaw, `${sessionId}.jsonl`)
  };
}

// Format entry content for display
function formatEntryContent(entry) {
  if (entry.type === 'user') {
    if (typeof entry.message === 'string') return entry.message;
    if (entry.message?.content) return entry.message.content;
    return JSON.stringify(entry.message);
  }
  
  if (entry.type === 'assistant') {
    if (typeof entry.message === 'string') return entry.message;
    if (entry.message?.content) {
      if (Array.isArray(entry.message.content)) {
        return entry.message.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n');
      }
      return entry.message.content;
    }
    return JSON.stringify(entry.message);
  }
  
  if (entry.type === 'tool_use') {
    return `🔧 Tool: ${entry.name || entry.tool}\nInput: ${JSON.stringify(entry.input || entry.arguments, null, 2)}`;
  }
  
  if (entry.type === 'tool_result') {
    const result = entry.result || entry.output || '';
    return `📤 Result: ${typeof result === 'string' ? result.substring(0, 500) : JSON.stringify(result).substring(0, 500)}`;
  }
  
  return JSON.stringify(entry, null, 2);
}

// Send initial data to new client
function sendInitialData(ws) {
  const sessions = getAllSessions();
  ws.send(JSON.stringify({
    type: 'init',
    sessions,
    claudeDir: CLAUDE_DIR
  }));
}

// Handle client messages
function handleClientMessage(ws, data) {
  switch (data.type) {
    case 'getSession':
      const details = getSessionDetails(data.projectRaw, data.sessionId);
      ws.send(JSON.stringify({
        type: 'sessionDetails',
        data: details
      }));
      break;
      
    case 'refresh':
      sendInitialData(ws);
      break;
  }
}

// Watch for file changes
function setupWatcher() {
  if (!fs.existsSync(CLAUDE_DIR)) {
    console.log('⚠️  Claude directory not found, creating watcher anyway...');
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  }
  
  const watcher = chokidar.watch(CLAUDE_DIR, {
    persistent: true,
    ignoreInitial: true,
    depth: 2
  });
  
  watcher.on('change', (filePath) => {
    if (filePath.endsWith('.jsonl')) {
      console.log('📝 File changed:', filePath);
      
      // Parse the changed file
      const parts = filePath.split(path.sep);
      const filename = parts.pop();
      const projectRaw = parts.pop();
      
      const entries = parseJsonlFile(filePath);
      const sessionInfo = extractSessionInfo(entries, projectRaw, filename);
      sessionInfo.filePath = filePath;
      sessionInfo.lastModified = new Date();
      
      // Broadcast update
      broadcast({
        type: 'sessionUpdate',
        session: sessionInfo,
        latestEntry: entries[entries.length - 1]
      });
    }
  });
  
  watcher.on('add', (filePath) => {
    if (filePath.endsWith('.jsonl')) {
      console.log('📄 New file:', filePath);
      broadcast({
        type: 'refresh'
      });
    }
  });
  
  console.log('👀 Watching:', CLAUDE_DIR);
}

// REST API endpoints
app.get('/api/sessions', (req, res) => {
  const sessions = getAllSessions();
  res.json(sessions);
});

app.get('/api/session/:projectRaw/:sessionId', (req, res) => {
  const { projectRaw, sessionId } = req.params;
  const details = getSessionDetails(projectRaw, sessionId);
  
  if (!details) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json(details);
});

app.get('/api/stats', (req, res) => {
  const sessions = getAllSessions();
  
  const stats = {
    totalSessions: sessions.length,
    totalTokens: sessions.reduce((sum, s) => sum + s.totalTokens, 0),
    totalInputTokens: sessions.reduce((sum, s) => sum + s.totalInputTokens, 0),
    totalOutputTokens: sessions.reduce((sum, s) => sum + s.totalOutputTokens, 0),
    totalMessages: sessions.reduce((sum, s) => sum + s.messageCount, 0),
    toolUsage: {},
    modelUsage: {}
  };
  
  // Aggregate tool usage
  sessions.forEach(s => {
    s.toolUses.forEach(tool => {
      stats.toolUsage[tool] = (stats.toolUsage[tool] || 0) + 1;
    });
    if (s.model) {
      stats.modelUsage[s.model] = (stats.modelUsage[s.model] || 0) + 1;
    }
  });
  
  res.json(stats);
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         🤖 Claude Dashboard Server Started 🤖              ║
╠═══════════════════════════════════════════════════════════╣
║  Dashboard:  http://localhost:${PORT}                        ║
║  API:        http://localhost:${PORT}/api/sessions           ║
║  WebSocket:  ws://localhost:${PORT}                          ║
║  Claude Dir: ${CLAUDE_DIR.substring(0, 40).padEnd(40)}║
╚═══════════════════════════════════════════════════════════╝
  `);
  
  setupWatcher();
});
