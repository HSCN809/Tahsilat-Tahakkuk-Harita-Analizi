# Multi-stage Dockerfile: Rust API + Python Scraper Runtime
# 1. Aşama: Rust binary derleme
FROM rust:slim-bookworm AS builder

WORKDIR /build

COPY backend_rust/Cargo.toml backend_rust/Cargo.lock* ./
COPY backend_rust/src ./src

RUN cargo build --release

# 2. Aşama: Python + Chromium + Rust API Çalışma Zamanı
FROM python:3.11.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates gosu \
       chromium chromium-driver sqlite3 \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium \
    CHROMEDRIVER_PATH=/usr/bin/chromedriver

WORKDIR /app

RUN groupadd --system appuser \
    && useradd --system --gid appuser --create-home --shell /usr/sbin/nologin appuser

# Python scraper bağımlılıkları
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Rust binary'sini kopyala
COPY --from=builder /build/target/release/backend_rust /usr/local/bin/backend_rust
RUN chmod +x /usr/local/bin/backend_rust

COPY . .

RUN chown -R appuser:appuser /app

EXPOSE 8080

ENV HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/app/veriler \
    DB_PATH=/app/veriler/tahsilat_tahakkuk.db

USER appuser

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/backend_rust"]
