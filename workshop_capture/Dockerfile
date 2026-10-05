# Built on the Pi by Home Assistant. Node 22.18+ runs the TypeScript source directly.
FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY web ./web

ENV NODE_ENV=production NODE_NO_WARNINGS=1
EXPOSE 8099
CMD ["node", "src/index.ts"]
