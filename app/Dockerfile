FROM node:22-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /build/dist ./dist
COPY --from=build /build/web-dist ./web-dist
EXPOSE 8096 8097
CMD ["node", "dist/index.js"]
