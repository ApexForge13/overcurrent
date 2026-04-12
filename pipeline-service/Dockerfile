FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root package files for shared deps
COPY package.json package-lock.json ./
COPY prisma/ ./prisma/
COPY prisma.config.ts ./

# Install root deps (shared code needs these)
RUN npm ci --omit=dev

# Generate Prisma client
RUN npx prisma generate

# Copy shared source code
COPY src/lib/ ./src/lib/
COPY src/agents/ ./src/agents/
COPY src/ingestion/ ./src/ingestion/
COPY src/data/ ./src/data/

# Copy pipeline service
COPY pipeline-service/ ./pipeline-service/

# Install pipeline service deps
WORKDIR /app/pipeline-service
RUN npm install

WORKDIR /app

EXPOSE 3001

# Run with tsx for TypeScript + path alias support
CMD ["npx", "tsx", "--tsconfig", "pipeline-service/tsconfig.json", "pipeline-service/server.ts"]
