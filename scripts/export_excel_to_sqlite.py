"""
Excel dosyalarını SQLite veritabanına aktaran ETL scripti.
Tüm yılları (2004-2026), ayları, illeri ve gelir kalemlerini tarayarak
optimize edilmiş ve indekslenmiş bir SQLite veritabanı oluşturur.
"""
from __future__ import annotations

import os
import re
import sys
import json
import sqlite3
import logging
from pathlib import Path

# Ana dizini sys.path'e ekle
BASE_DIR = Path(__file__).resolve().parent.parent
LIB_DIR = BASE_DIR / "Tahsilat Tahakkuk Harita Analizi"
sys.path.insert(0, str(LIB_DIR))

import pandas as pd
import numpy as np
import Tahsilat_Tahakkuk_Grafik_Olusturma_Projesi as lib

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("etl")


def init_db(db_path: Path) -> sqlite3.Connection:
    """Veritabanı şemasını ve indekslerini oluşturur."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")

    conn.execute("""
    CREATE TABLE IF NOT EXISTS tax_records (
        year INTEGER NOT NULL,
        month TEXT NOT NULL,
        category_id TEXT NOT NULL,
        category_clean TEXT NOT NULL,
        province TEXT NOT NULL,
        accrual REAL,
        collection REAL,
        ratio REAL,
        PRIMARY KEY (year, month, category_clean, province)
    );
    """)

    conn.execute("""
    CREATE INDEX IF NOT EXISTS idx_tax_lookup
    ON tax_records(year, category_clean, month);
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS metadata_config (
        year INTEGER PRIMARY KEY,
        months_json TEXT NOT NULL,
        categories_json TEXT NOT NULL
    );
    """)

    conn.commit()
    return conn


def process_year(year: int, year_folder: Path) -> tuple[int, list[dict], list[str], list[dict]]:
    """Tek bir yılın tüm il/ay Excel dosyalarını okuyup satır listesi üretir."""
    logger.info(f"İşleniyor: Yıl {year}")
    records = []
    
    il_dirs = sorted([
        d for d in os.listdir(year_folder)
        if (year_folder / d).is_dir() and re.match(r"^\d{2}_", d)
    ])

    if not il_dirs:
        return year, [], [], []

    # Ayları belirle
    ilk_il_klasoru = year_folder / il_dirs[0]
    aylik_dosyalar = [f for f in os.listdir(ilk_il_klasoru) if f.endswith(".xlsx")]
    aylar = [os.path.splitext(f)[0] for f in aylik_dosyalar]
    aylar_lower = [a.lower() for a in aylar]
    mevcut_aylar = [ay for ay in lib.AY_SIRALAMASI if ay.lower() in aylar_lower]

    categories_map: dict[str, str] = {}  # clean -> (id, title)
    cleaned_categories_list = []

    for month_name in mevcut_aylar:
        for il_dir_name in il_dirs:
            il_adi = "_".join(il_dir_name.split("_")[1:]) if "_" in il_dir_name else il_dir_name
            excel_path = year_folder / il_dir_name / f"{month_name}.xlsx"
            if not excel_path.exists():
                continue

            try:
                df_raw = pd.read_excel(excel_path)
                header_row_idx = None
                for idx in range(len(df_raw)):
                    row_values = [str(val).lower().strip() for val in df_raw.iloc[idx].tolist()]
                    if any("tahakkuk" in val for val in row_values) and any("tahsilat" in val for val in row_values):
                        header_row_idx = idx
                        break

                if header_row_idx is None:
                    continue

                df = lib.kolonlari_ayarla(df_raw, header_row_idx)
                if df is None:
                    continue

                df.set_index("index", inplace=True)
                for col in ["tahakkuk", "tahsilat", "tahsilat/tahakkuk"]:
                    df[col] = pd.to_numeric(df[col], errors="coerce")

                df = df.dropna(subset=["tahakkuk", "tahsilat"], how="all")

                for cat_raw, row in df.iterrows():
                    if not isinstance(cat_raw, str) or not cat_raw.strip():
                        continue
                    
                    clean_lookup = lib.temizle_metin(cat_raw)
                    if clean_lookup not in categories_map:
                        title_name = re.sub(r"^\d+\.\s*", "", cat_raw.strip()).title()
                        categories_map[clean_lookup] = (cat_raw, title_name)

                    accrual = row["tahakkuk"]
                    collection = row["tahsilat"]
                    excel_ratio = row["tahsilat/tahakkuk"]

                    accrual_val = float(accrual) if pd.notna(accrual) else None
                    collection_val = float(collection) if pd.notna(collection) else None

                    # Oran hesabi
                    if accrual_val is not None and accrual_val > 0:
                        c_val = collection_val if collection_val is not None else 0.0
                        ratio_val = round((c_val / accrual_val) * 100, 2)
                    elif accrual_val is not None and accrual_val == 0 and collection_val is not None and collection_val > 0:
                        ratio_val = 100.0
                    elif pd.notna(excel_ratio):
                        ratio_val = float(excel_ratio)
                    else:
                        ratio_val = 0.0

                    records.append({
                        "year": year,
                        "month": month_name,
                        "category_id": cat_raw,
                        "category_clean": clean_lookup,
                        "province": il_adi,
                        "accrual": accrual_val,
                        "collection": collection_val,
                        "ratio": ratio_val,
                    })

            except Exception:
                logger.warning(f"Hata: {excel_path}", exc_info=True)
                continue

    for clean_lookup, (cat_raw, title_name) in categories_map.items():
        cleaned_categories_list.append({
            "id": cat_raw,
            "name": title_name,
            "clean": clean_lookup,
        })

    return year, records, mevcut_aylar, cleaned_categories_list


def export_all_to_sqlite(db_path: Path | None = None) -> Path:
    """Tüm Excel verilerini SQLite veritabanına aktarır."""
    if db_path is None:
        db_path = lib.VERILER_DIR / "tahsilat_tahakkuk.db"

    logger.info(f"SQLite veritabanı oluşturuluyor: {db_path}")
    conn = init_db(db_path)

    ana_klasor = lib.ana_klasor
    if not ana_klasor or not ana_klasor.exists():
        logger.error(f"Ana veri klasörü bulunamadı: {ana_klasor}")
        return db_path

    year_folders = []
    for d in os.listdir(ana_klasor):
        p = ana_klasor / d
        if p.is_dir():
            m = re.search(r"\d{4}", d)
            if m:
                year_folders.append((int(m.group(0)), p))

    year_folders.sort(key=lambda x: x[0])

    total_records = 0
    with conn:
        for year, folder in year_folders:
            y, records, aylar, categories = process_year(year, folder)
            if not records:
                continue

            # Önce bu yıla ait eski kayıtları temizle
            conn.execute("DELETE FROM tax_records WHERE year = ?", (y,))
            conn.execute("DELETE FROM metadata_config WHERE year = ?", (y,))

            # Verileri toplu ekle
            conn.executemany("""
            INSERT OR REPLACE INTO tax_records
            (year, month, category_id, category_clean, province, accrual, collection, ratio)
            VALUES (:year, :month, :category_id, :category_clean, :province, :accrual, :collection, :ratio)
            """, records)

            # Metadata ekle
            conn.execute("""
            INSERT OR REPLACE INTO metadata_config (year, months_json, categories_json)
            VALUES (?, ?, ?)
            """, (
                y,
                json.dumps(aylar, ensure_ascii=False),
                json.dumps([{"id": c["id"], "name": c["name"]} for c in categories], ensure_ascii=False)
            ))

            total_records += len(records)
            logger.info(f"Yıl {y} kaydedildi: {len(records)} kayıt, {len(categories)} kategori.")

    conn.close()
    logger.info(f"ETL tamamlandı! Toplam {total_records} satır veri {db_path} dosyasına yazıldı.")
    return db_path


if __name__ == "__main__":
    export_all_to_sqlite()
