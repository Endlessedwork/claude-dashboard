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
    // Count tokens - check both entry.usage and entry.message.usage
    const usage = entry.usage || entry.message?.usage;
    if (usage) {
      totalInputTokens += usage.input_tokens || 0;
      totalOutputTokens += usage.output_tokens || 0;
      // Also count cache tokens
      totalInputTokens += usage.cache_creation_input_tokens || 0;
      totalInputTokens += usage.cache_read_input_tokens || 0;
    }

    // Count messages
    if (entry.type === 'user' || entry.type === 'assistant') {
      messageCount++;
    }

    // Get first user message
    if (entry.type === 'user' && !firstUserMessage && entry.message) {
      let msg = '';
      if (typeof entry.message === 'string') {
        msg = entry.message;
      } else if (entry.message.content) {
        if (typeof entry.message.content === 'string') {
          msg = entry.message.content;
        } else if (Array.isArray(entry.message.content)) {
          msg = entry.message.content
            .filter(c => c.type === 'text')
            .map(c => c.text || '')
            .join(' ');
        } else {
          msg = JSON.stringify(entry.message.content);
        }
      } else {
        msg = JSON.stringify(entry.message);
      }
      firstUserMessage = String(msg).substring(0, 200);
    }

    // Get summary if available
    if (entry.type === 'summary' && entry.summary) {
      if (typeof entry.summary === 'string') {
        summary = entry.summary;
      } else if (entry.summary.content) {
        summary = typeof entry.summary.content === 'string'
          ? entry.summary.content
          : JSON.stringify(entry.summary.content);
      } else {
        summary = JSON.stringify(entry.summary);
      }
    }

    // Track tool uses - check content array for tool_use blocks
    if (entry.type === 'tool_use' || entry.tool) {
      const toolName = entry.tool || entry.name || 'unknown';
      if (!toolUses.includes(toolName)) {
        toolUses.push(toolName);
      }
    }
    // Also check assistant message content for tool_use blocks
    if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block.type === 'tool_use' && block.name) {
          if (!toolUses.includes(block.name)) {
            toolUses.push(block.name);
          }
        }
      }
    }

    // Get model - check both entry.model and entry.message.model
    if (!model) {
      model = entry.model || entry.message?.model || '';
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

// Extract content from tool_result
function extractToolResultContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(c => {
      if (c.type === 'text' && c.text) return c.text;
      if (typeof c === 'string') return c;
      return JSON.stringify(c);
    }).join('\n');
  }
  return JSON.stringify(content);
}

// Format entry content for display
function formatEntryContent(entry) {
  // Handle user messages
  if (entry.type === 'user') {
    // Try entry.message first
    if (typeof entry.message === 'string') return entry.message;
    if (entry.message?.content) {
      if (typeof entry.message.content === 'string') return entry.message.content;
      if (Array.isArray(entry.message.content)) {
        // Check for tool_result in content array
        const toolResults = entry.message.content.filter(c => c.type === 'tool_result');
        if (toolResults.length > 0) {
          // Return structured data for tool results
          return {
            type: 'tool_results',
            results: toolResults.map(tr => ({
              tool_use_id: tr.tool_use_id,
              content: extractToolResultContent(tr.content)
            }))
          };
        }

        const texts = entry.message.content
          .map(c => {
            if (c.type === 'text' && c.text) return c.text;
            if (typeof c === 'string') return c;
            return null;
          })
          .filter(Boolean);
        if (texts.length > 0) return texts.join('\n');
      }
    }
    // Try entry.content directly
    if (entry.content) {
      if (typeof entry.content === 'string') return entry.content;
      if (Array.isArray(entry.content)) {
        const texts = entry.content
          .map(c => {
            if (c.type === 'text' && c.text) return c.text;
            if (typeof c === 'string') return c;
            return null;
          })
          .filter(Boolean);
        if (texts.length > 0) return texts.join('\n');
      }
    }
    // Fallback: stringify the whole message
    if (entry.message) return JSON.stringify(entry.message, null, 2);
    return JSON.stringify(entry, null, 2);
  }
  
  // Handle assistant messages
  if (entry.type === 'assistant') {
    if (typeof entry.message === 'string') return entry.message;
    if (entry.message?.content) {
      if (typeof entry.message.content === 'string') return entry.message.content;
      if (Array.isArray(entry.message.content)) {
        const parts = [];
        for (const block of entry.message.content) {
          if (block.type === 'text' && block.text) {
            parts.push(block.text);
          } else if (block.type === 'thinking' && block.thinking) {
            parts.push(`💭 Thinking:\n${block.thinking.substring(0, 500)}...`);
          } else if (block.type === 'tool_use') {
            parts.push(`🔧 Tool: ${block.name}\nInput: ${JSON.stringify(block.input, null, 2).substring(0, 300)}`);
          }
        }
        return parts.join('\n\n') || '[Processing...]';
      }
    }
    // Check for direct content field
    if (entry.content) {
      if (typeof entry.content === 'string') return entry.content;
      if (Array.isArray(entry.content)) {
        const texts = entry.content
          .filter(c => c.type === 'text')
          .map(c => c.text || '');
        return texts.join('\n') || '[Response]';
      }
    }
    return entry.message ? JSON.stringify(entry.message, null, 2) : '[Empty response]';
  }
  
  // Handle tool use
  if (entry.type === 'tool_use') {
    const toolName = entry.name || entry.tool || 'unknown';
    const input = entry.input || entry.arguments || {};
    return `🔧 Tool: ${toolName}\nInput: ${JSON.stringify(input, null, 2).substring(0, 500)}`;
  }
  
  // Handle tool result
  if (entry.type === 'tool_result') {
    const result = entry.result || entry.output || entry.content || '';
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    return `📤 Result: ${resultStr.substring(0, 500)}${resultStr.length > 500 ? '...' : ''}`;
  }

  // Handle summary
  if (entry.type === 'summary') {
    return `📝 Summary: ${entry.summary || ''}`;
  }

  // Handle other types - show type name and brief content
  const typeLabel = entry.type || 'unknown';
  return `ℹ️ ${typeLabel}: ${JSON.stringify(entry, null, 2).substring(0, 300)}`;
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
