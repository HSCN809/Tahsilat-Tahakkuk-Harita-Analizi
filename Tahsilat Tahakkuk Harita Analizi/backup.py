"""
veriler/ klasörünü tar.gz olarak yedekler.

Her çağrıda:
  - Zaman damgalı yeni bir snapshot oluşturur (örn. veriler-snapshot-20250712T143000.tar.gz)
  - En son snapshot'a "veriler-snapshot.tar.gz" olarak sabit isimli kopya oluşturur
    (geriye dönük uyumluluk için — mevcut restore script'leri bu dosyayı kullanır)
  - Eski snapshot'ları temizler (varsayılan: son 5 snapshot korunur)

Rotasyon sayısı SNAPSHOT_RETENTION ortam değişkeni ile değiştirilebilir.
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

# Korunacak maksimum timestamp'li snapshot sayısı (ortam değişkeninden okunur)
_SNAPSHOT_RETENTION = int(os.environ.get("SNAPSHOT_RETENTION", "5"))

# Zaman damgasız, sabit isimli son snapshot (geriye dönük uyumluluk için)
_LATEST_SNAPSHOT_NAME = "veriler-snapshot.tar.gz"


def _list_snapshots(backup_root: Path) -> list[Path]:
    """backup_root içindeki timestamp'li snapshot dosyalarını eskiden yeniye sıralar."""
    if not backup_root.exists():
        return []
    snapshots = sorted(
        backup_root.glob("veriler-snapshot-*.tar.gz"),
        key=lambda p: p.stat().st_mtime,
    )
    return snapshots


def _rotate_snapshots(backup_root: Path, retention: int) -> None:
    """Retention sayısından fazla olan en eski snapshot'ları siler."""
    snapshots = _list_snapshots(backup_root)
    excess = len(snapshots) - retention
    for old in snapshots[:excess]:
        old.unlink()


def take_snapshot(src_dir: str | os.PathLike, backup_root: str | os.PathLike) -> str:
    """
    src_dir içeriğini iki kopya olarak paketler:

    1. backup_root/veriler-snapshot-<timestamp>.tar.gz  — rotasyonlu kopya
    2. backup_root/veriler-snapshot.tar.gz             — sabit isimli son kopya

    #2, #1'in kopyasıdır; geriye dönük uyumluluk için üzerine yazılır.

    Returns: sabit isimli son snapshot'ın mutlak yolu (veriler-snapshot.tar.gz).
    """
    src = Path(src_dir)
    dst = Path(backup_root)
    if not src.exists():
        raise FileNotFoundError(f"Kaynak dizin bulunamadı: {src}")

    dst.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    timestamped_name = f"veriler-snapshot-{timestamp}.tar.gz"
    latest_name = _LATEST_SNAPSHOT_NAME

    # Önce geçici dosyaya yaz, sonra atomik olarak taşı
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

        # Zaman damgalı kopya (rotasyonlu)
        ts_target = dst / timestamped_name
        shutil.copy2(str(tmp_path), str(ts_target))

        # Sabit isimli son kopya (geriye dönük uyumlu)
        latest_target = dst / latest_name
        shutil.move(str(tmp_path), str(latest_target))
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink()
        raise

    # Eski snapshot'ları temizle
    _rotate_snapshots(dst, _SNAPSHOT_RETENTION)

    return str(latest_target.resolve())
