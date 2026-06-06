# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY webapp/package.json webapp/package-lock.json* ./webapp/

RUN npm ci 2>/dev/null || npm install
RUN cd webapp && (npm ci 2>/dev/null || npm install)

COPY tsconfig.json ./
COPY src ./src
COPY webapp ./webapp

RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/webapp/dist ./webapp/dist

RUN mkdir -p data uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
