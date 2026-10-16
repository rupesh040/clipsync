FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:signaling
FROM node:22-alpine
WORKDIR /app
COPY --from=build --chown=node:node /app/server/dist/index.cjs ./index.cjs
USER node
ENV HOST=0.0.0.0 PORT=3012
EXPOSE 3012
CMD ["node", "index.cjs"]
