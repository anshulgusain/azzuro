# Azzurro guest reviews: dashboard, API, chat assistant and review collector in one container.
# Node 24 (built-in SQLite) plus Playwright's Chromium for the collector.
FROM node:24-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Dependencies first, so code changes don't reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm

# App code, then build the dashboard into dist/web.
COPY . .
RUN npm run build

# Render sets PORT (10000 by default); the server listens on 0.0.0.0.
ENV PORT=10000
EXPOSE 10000
CMD ["node", "--import", "tsx", "src/server/index.ts"]
