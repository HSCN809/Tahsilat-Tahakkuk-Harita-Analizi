# --- Stage 1: Build ---
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# --- Stage 2: Serve (nginx) ---
FROM nginx:alpine
# NGINX_CONF arg ile dev/prod nginx yapılandırması seçimi
# Production (varsayılan): nginx.conf
# Development: nginx-dev.conf
ARG NGINX_CONF=nginx.conf
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
