FROM node:26-bookworm-slim

LABEL version="1.0" maintainer="Espen Hovlandsdal <espen@hovlandsdal.com>"

ENV NODE_ENV=production

WORKDIR /srv/app

# Install app dependencies (pre-source copy in order to cache dependencies)
COPY package.json package-lock.json ./

# Production dependencies only — the source is executed directly through Node's
# built-in TypeScript stripping, so there is no build/transpile step.
RUN npm ci --omit=dev

# Bundle app source
COPY . .

# Gamespy master server port (TCP)
EXPOSE 27900

CMD ["node", "src/server.ts"]
