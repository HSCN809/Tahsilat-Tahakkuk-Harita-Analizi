"""
Tahsilat-Tahakkuk HMB Veri Kazıyıcı ve Excel ETL Paketi
"""
try:
    from .excel_parser import (
        FOLDER_NAME_TEMPLATE,
        AY_SIRALAMASI,
        safe_decode,
        excel_dosyalarini_oku,
        veri_hazirla,
        export_all_to_sqlite,
        init_db,
    )
except ImportError:
    from excel_parser import (
        FOLDER_NAME_TEMPLATE,
        AY_SIRALAMASI,
        safe_decode,
        excel_dosyalarini_oku,
        veri_hazirla,
        export_all_to_sqlite,
        init_db,
    )

__all__ = [
    "FOLDER_NAME_TEMPLATE",
    "AY_SIRALAMASI",
    "safe_decode",
    "excel_dosyalarini_oku",
    "veri_hazirla",
    "export_all_to_sqlite",
    "init_db",
]
