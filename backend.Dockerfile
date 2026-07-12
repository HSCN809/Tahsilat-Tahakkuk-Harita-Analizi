FROM python:3.11.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

WORKDIR "/app/Tahsilat Tahakkuk Harita Analizi"

EXPOSE 8080

ENV HOST=0.0.0.0 \
    PORT=8080 \
    WORKERS=1

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["sh","-c","exec uvicorn api:app --host ${HOST} --port ${PORT} --workers ${WORKERS} --proxy-headers --forwarded-allow-ips='*' --no-access-log --timeout-graceful-shutdown 30"]
