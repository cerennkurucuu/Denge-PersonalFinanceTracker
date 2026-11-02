FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY my-finance/package.json my-finance/package-lock.json ./
RUN npm ci

COPY my-finance/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/scripts/load-local-env.cjs ./scripts/load-local-env.cjs
COPY --from=build --chown=node:node /app/dist/my-finance/browser ./dist/my-finance/browser

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.cjs"]
