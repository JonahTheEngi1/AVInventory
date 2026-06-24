FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY index.html styles.css app.js ./

ENV NODE_ENV=production
ENV PORT=8001
ENV DATA_DIR=/app/data

EXPOSE 8001

CMD ["node", "server.js"]
