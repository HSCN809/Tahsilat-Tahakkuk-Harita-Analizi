FROM python:3.11.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN groupadd --system appuser \
    && useradd --system --gid appuser --create-home --shell /usr/sbin/nologin appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chown -R appuser:appuser /app
USER appuser

WORKDIR "/app/Tahsilat Tahakkuk Harita Analizi"

EXPOSE 8000

ENV HOST=0.0.0.0 \
    PORT=8000 \
    WORKERS=2

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["sh","-c","exec uvicorn api:app --host ${HOST} --port ${PORT} --workers ${WORKERS} --proxy-headers --forwarded-allow-ips='*' --no-access-log"]
