# vf-sftp's container — decision 0620. Node and the ssh2 library, serving
# runner.mjs on port 8080 to vf-sftp's Worker. Built by `wrangler deploy`
# (Docker must be running where it is deployed from).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY runner.mjs server.mjs ./
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
