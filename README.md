# 🤖 Claude Dashboard

Real-time dashboard สำหรับ monitor Claude Code sessions

![Dashboard](https://img.shields.io/badge/Claude-Dashboard-purple)
![Node](https://img.shields.io/badge/Node.js-20+-green)

## ✨ Features

- 📊 **Real-time Monitoring** - ดู conversation ของ Claude แบบ live
- 💬 **Session Browser** - เรียกดู sessions ทั้งหมด
- 📈 **Token Tracking** - ติดตาม token usage
- 🔧 **Tool Usage** - ดูว่า Claude ใช้ tools อะไรบ้าง
- 🔍 **Search** - ค้นหา sessions ได้
- 📤 **Export** - Export session เป็น JSON

## 🚀 Quick Start

### วิธีที่ 1: รัน Direct (แนะนำสำหรับ Development)

```bash
# ติดตั้ง dependencies
npm install

# รัน server
npm start

# หรือ dev mode (auto-reload)
npm run dev
```

เปิด browser: http://localhost:3456

### วิธีที่ 2: Docker

```bash
# Build และ run
docker-compose up -d

# ดู logs
docker-compose logs -f
```

### วิธีที่ 3: Docker (ไม่ใช้ compose)

```bash
# Build image
docker build -t claude-dashboard .

# Run container
docker run -d \
  --name claude-dashboard \
  -p 3456:3456 \
  -v ~/.claude:/root/.claude:ro \
  -e CLAUDE_DIR=/root/.claude/projects \
  claude-dashboard
```

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3456 | Server port |
| `CLAUDE_DIR` | ~/.claude/projects | Path to Claude projects directory |

### ปรับ Claude Directory

ถ้า Claude directory อยู่คนละที่:

```bash
# รัน direct
CLAUDE_DIR=/path/to/.claude/projects npm start

# หรือแก้ใน docker-compose.yml
volumes:
  - /custom/path/.claude:/root/.claude:ro
```

## 📁 Project Structure

```
claude-dashboard/
├── backend/
│   └── server.js       # Main server (Express + WebSocket)
├── frontend/
│   └── index.html      # Dashboard UI
├── package.json
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 🔌 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | รายการ sessions ทั้งหมด |
| `/api/session/:project/:id` | GET | รายละเอียด session |
| `/api/stats` | GET | สถิติรวม |

## 🌐 WebSocket Events

### Client → Server
- `getSession` - ขอรายละเอียด session
- `refresh` - รีเฟรช sessions

### Server → Client
- `init` - ข้อมูลเริ่มต้น
- `sessionUpdate` - session มีการอัพเดท
- `sessionDetails` - รายละเอียด session

## 🚢 Deploy บน Easypanel

1. สร้าง App ใหม่แบบ "Docker"
2. เลือก GitHub repo หรือ upload source
3. ตั้งค่า:
   - Port: 3456
   - Volume: `/home/abc/.claude` → `/root/.claude`
4. Deploy!

## 📝 License

MIT

## 🙏 Credits

Built for monitoring Claude Code CLI sessions
