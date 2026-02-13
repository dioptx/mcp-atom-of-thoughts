FROM node:lts-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --ignore-scripts

COPY . .
RUN npm run build

CMD ["node", "build/index.js", "--output-dir", "/tmp/aot-diagrams", "--downloads-dir", "/tmp/aot-downloads"]
