FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY public ./public
COPY server ./server
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
