"""
veriler/ klasörünü tar.gz olarak yedekler.

Tek bir snapshot alır; her çağrıda önceki snapshot'ın üzerine yazar
(rotating yedek yok, sadece "son başarılı scrape öncesi durum").

Yedek olarak ya host klasörü (bind mount) ya da named volume kullanılır.
prod'da BACKUP_DIR env ile dizin ayarlanır (örn. /var/backups/...).
"""
from __future__ import annotations

import os
import shutil
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def take_snapshot(src_dir: str | os.PathLike, backup_root: str | os.PathLike) -> str:
    """
    src_dir içeriğini backup_root/<snapshot_name>.tar.gz olarak paketler.
    Aynı ada sahip dosya varsa üzerine yazar.

    Returns: oluşturulan dosyanın mutlak yolu.
    """
    src = Path(src_dir)
    dst = Path(backup_root)
    if not src.exists():
        raise FileNotFoundError(f"Kaynak dizin bulunamadı: {src}")

    dst.mkdir(parents=True, exist_ok=True)

    snapshot_name = f"veriler-snapshot.tar.gz"
    target = dst / snapshot_name

    with tempfile.NamedTemporaryFile(
        "wb",
        dir=str(dst),
        prefix=".tmp-snapshot-",
        suffix=".tar.gz",
        delete=False,
    ) as tmp:
        tmp_path = Path(tmp.name)

    try:
        with tarfile.open(tmp_path, "w:gz") as tf:
            tf.add(str(src), arcname=src.name, recursive=True)
        shutil.move(str(tmp_path), str(target))
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink()
        raise

    return str(target.resolve())
