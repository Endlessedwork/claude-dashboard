#!/bin/bash

# Claude Dashboard Start Script
# ================================

set -e

echo "🤖 Claude Dashboard"
echo "==================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ required. Current: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v)"

# Check Claude directory
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude/projects}"
if [ ! -d "$CLAUDE_DIR" ]; then
    echo "⚠️  Claude directory not found: $CLAUDE_DIR"
    echo "   Creating directory..."
    mkdir -p "$CLAUDE_DIR"
fi

echo "📁 Claude Dir: $CLAUDE_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Set port
PORT="${PORT:-3456}"
echo "🌐 Port: $PORT"

echo ""
echo "🚀 Starting server..."
echo "   Dashboard: http://localhost:$PORT"
echo "   API:       http://localhost:$PORT/api/sessions"
echo ""

# Start server
exec node backend/server.js
