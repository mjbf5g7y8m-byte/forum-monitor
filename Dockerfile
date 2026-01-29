FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy app files
COPY dashboard-server.js .
COPY monitor.js .
COPY .forum-monitor-state.json* ./

# Create start script
RUN echo '#!/bin/bash\nnode dashboard-server.js &\nsleep 2\nnode monitor.js' > start.sh && chmod +x start.sh

EXPOSE 3000

CMD ["./start.sh"]
