FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source
COPY backend ./backend
COPY frontend ./frontend

# Expose port
EXPOSE 3456

# Environment
ENV NODE_ENV=production
ENV PORT=3456

# Start
CMD ["node", "backend/server.js"]
