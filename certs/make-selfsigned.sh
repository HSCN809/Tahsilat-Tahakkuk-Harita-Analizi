#!/usr/bin/env bash
# Geliştirme/test için self-signed sertifika üretir (./certs altına).
# Üretimde gerçek sertifika için certbot kullanın.
set -euo pipefail

cd "$(dirname "$0")"

openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout privkey.pem \
  -out fullchain.pem \
  -subj "/C=TR/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "Self-signed sertifika oluşturuldu: certs/fullchain.pem, certs/privkey.pem"
