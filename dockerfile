FROM node:20-alpine

WORKDIR /app

# Install deps first (better cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app
COPY . .

# Make sure DB folder exists (we'll mount /app/data)
RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000

# NOTE: change if your start script differs
CMD ["npm", "start"]
