FROM node:22-alpine
WORKDIR /app
COPY package.json config.js server.js painel.html ./
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
