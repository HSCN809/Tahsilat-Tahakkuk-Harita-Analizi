import os
import re
import json
import sys
import logging
import subprocess
import pandas as pd
import numpy as np
from pathlib import Path
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

# api.py dosyasının bulunduğu dizini Python sistem yoluna ekle (İçe aktarmaların sorunsuz çalışması için)
CURRENT_DIR = Path(__file__).resolve().parent
sys.path.append(str(CURRENT_DIR))

# Kütüphane modülünü import et
import Tahsilat_Tahakkuk_Grafik_Olusturma_Projesi as lib

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Tahsilat Tahakkuk Veri API",
    description="İl bazında vergi gelirleri tahsilat-tahakkuk ve oran analizlerini sunan backend servisi.",
    version="2.0.0"
)

# CORS ayarları — izin verilen origin'ler env değişkeninden okunur
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:8000,http://127.0.0.1:5173"
    ).split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Input validation yardımcıları ---
# Geçerli yıl aralığı (HMB verisi 2004+ başlıyor, geleceğe margin)
_MIN_YEAR = 2000
_MAX_YEAR = 2100

# year_input formatı: "2024", "2024-2025", "2024-2025,2023", "hepsi"
_YEAR_INPUT_RE = re.compile(r"^(hepsi|\d{4}(-\d{4})?(,\d{4}(-\d{4})?)*)$", re.IGNORECASE)


def _validate_year(year: int) -> None:
    """Year parametresini doğrular, geçersizse 400 fırlatır."""
    if not (_MIN_YEAR <= year <= _MAX_YEAR):
        raise HTTPException(status_code=400, detail=f"Geçersiz yıl: {year}. Yıl {_MIN_YEAR}-{_MAX_YEAR} aralığında olmalı.")


def _validate_year_input(year_input: str) -> None:
    """Scrape year_input parametresini regex ile doğrular, geçersizse 400 fırlatır."""
    if not year_input or not _YEAR_INPUT_RE.match(year_input.strip()):
        raise HTTPException(
            status_code=400,
            detail="Geçersiz yıl formatı. Örnekler: 2024, 2024-2025, 2024-2025,2023, hepsi"
        )


async def run_scraper_bg(year_input: str):
    """
    Arka planda veri çekme scriptini çalıştırır.
    subprocess.communicate() bloklayıcı olduğu için threadpool'a alınır.
    """
    script_path = CURRENT_DIR / "Hazine_Maliye_Bakanlığı_Sitesinden_Excel_Dosyalarını_Çekme.py"
    try:
        logger.info("Arka plan veri çekme işlemi başlatıldı: %r", year_input)
        process = subprocess.Popen(
            [sys.executable, str(script_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8"
        )
        # Bloklayıcı communicate() çağrısını threadpool'a taşı
        stdout, stderr = await run_in_threadpool(
            process.communicate, input=year_input + "\n"
        )
        logger.info("Arka plan veri çekici tamamlandı. Çıktı: %s...", stdout[:200])
        # Önbelleği temizle ki yeni veriler yüklensin
        lib.clear_cache()
        if stderr:
            logger.warning("Veri çekici hata çıktısı: %s...", stderr[:200])
    except Exception:
        logger.exception("Arka plan veri çekici hatası")

@app.get("/")
def read_root():
    return {
        "status": "online",
        "message": "Tahsilat Tahakkuk Veri API aktif durumda.",
        "endpoints": {
            "GET /api/years": "Mevcut yılları listeler",
            "GET /api/config?year=2025": "Yıla ait ayları ve gelir kalemlerini tek istekte döner",
            "GET /api/data?year=2025&category=Özel Tüketim Vergisi": "Yıl ve kalem bazlı ham il verilerini listeler",
            "GET /api/geojson": "Türkiye sınırları GeoJSON dosyasını döner",
            "POST /api/scrape?year_input=2024-2025": "Arka planda veri indirmeyi başlatır"
        }
    }

@app.get("/api/years")
async def get_years():
    """
    Klasörde mevcut yılları tespit edip listeler.
    """
    try:
        alt_klasorler = await run_in_threadpool(
            lambda: sorted(
                [f for f in os.listdir(lib.ana_klasor) if os.path.isdir(os.path.join(lib.ana_klasor, f))],
                key=lambda x: int(re.search(r"\d{4}", x).group(0)) if re.search(r"\d{4}", x) else 0
            )
        )
        years = []
        for folder in alt_klasorler:
            match = re.search(r"\d{4}", folder)
            if match:
                years.append(int(match.group(0)))
        return {"years": sorted(list(set(years)))}
    except Exception:
        logger.exception("Yıllar listelenirken hata oluştu")
        raise HTTPException(status_code=500, detail="Yıllar listelenirken hata oluştu.")

def _hesapla_config(year: int) -> dict:
    """
    Seçilen yıla ait aylar ve kategorileri diskten okuyarak hesaplar.
    Yıl aynı kaldıkça tekrar disk okumamak için önbellekten desteklenir.
    """
    cached = lib._config_cache.get(year)
    if cached is not None:
        logger.debug("Config önbellekten getirildi: yıl %s", year)
        return cached

    folder_name = f"İllere Göre Tahsilat Tahakkuk {year}"
    folder_path = os.path.join(lib.ana_klasor, folder_name)

    if not os.path.exists(folder_path):
        raise FileNotFoundError(f"{year} yılına ait veri klasörü bulunamadı.")

    # --- Ayları hesapla ---
    il_dirs = [
        d for d in os.listdir(folder_path)
        if os.path.isdir(os.path.join(folder_path, d)) and re.match(r"^\d{2}_", d)
    ]
    mevcut_aylar: list[str] = []
    if il_dirs:
        ilk_il_klasoru = os.path.join(folder_path, il_dirs[0])
        aylik_dosyalar = [f for f in os.listdir(ilk_il_klasoru) if f.endswith('.xlsx')]
        aylar = [os.path.splitext(f)[0] for f in aylik_dosyalar]
        AY_SIRALAMASI = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
        aylar_lower = [a.lower() for a in aylar]
        mevcut_aylar = [ay for ay in AY_SIRALAMASI if ay.lower() in aylar_lower]

    # --- Kategorileri hesapla ---
    excel_files = [f for f in os.listdir(folder_path) if f.endswith('.xlsx')]
    cleaned_categories: list[dict] = []
    if excel_files:
        dosya_yolu = os.path.join(folder_path, excel_files[0])
        try:
            df_raw = pd.read_excel(dosya_yolu)
            header_row_idx = None
            for idx in range(len(df_raw)):
                row_values = [str(val).lower().strip() for val in df_raw.iloc[idx].tolist()]
                if any("tahakkuk" in val for val in row_values) and any("tahsilat" in val for val in row_values):
                    header_row_idx = idx
                    break

            if header_row_idx is not None:
                df = lib.kolonlari_ayarla(df_raw, header_row_idx)
                if df is not None:
                    raw_categories = [i for i in df['index'] if isinstance(i, str)]
                    for cat in raw_categories:
                        clean_name = re.sub(r"^\d+\.\s*", "", cat.strip()).title()
                        cleaned_categories.append({"id": cat, "name": clean_name})
        except Exception:
            pass  # Kategoriler okunamazsa boş döner

    result = {
        "year": year,
        "months": mevcut_aylar,
        "categories": cleaned_categories
    }
    lib._config_cache.set(year, result)
    return result

@app.get("/api/config")
async def get_config(year: int):
    """
    Seçilen yıla ait aylar ve kategorileri TEK bir istekle döner.
    Frontend yıl değiştiğinde sadece bu endpoint'i çağırır.
    Yıl aynı kaldıkça önbellekten anında döner.
    """
    _validate_year(year)
    try:
        return await run_in_threadpool(_hesapla_config, year)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"{year} yılına ait veri klasörü bulunamadı.")
    except Exception:
        logger.exception("Config hesaplanırken hata oluştu (year=%s)", year)
        raise HTTPException(status_code=500, detail="Config hesaplanırken hata oluştu.")

@app.get("/api/data")
async def get_data(year: int, category: str, month: str = ""):
    """
    Belirli bir yıl, vergi kalemi ve ay için 81 ilin tahakkuk, tahsilat ve oran verilerini döner.
    Ay belirtilmezse (boş) yıllık özet veri kullanılır.
    """
    _validate_year(year)
    folder_name = f"İllere Göre Tahsilat Tahakkuk {year}"
    folder_path = os.path.join(lib.ana_klasor, folder_name)

    if not os.path.exists(folder_path):
        raise HTTPException(status_code=404, detail=f"{year} yılına ait veri klasörü bulunamadı.")

    try:
        # Ağır I/O ve CPU işlemlerini threadpool'a taşı
        iller_dict, _ = await run_in_threadpool(lib.excel_dosyalarini_oku, folder_path, month=month)
        data_df = await run_in_threadpool(lib.veri_hazirla, iller_dict, category)

        if data_df.empty:
            return {
                "year": year,
                "category": category,
                "summary": {"total_accrual": 0, "total_collection": 0, "overall_ratio": 0},
                "data": []
            }

        data_df = data_df.replace({np.nan: None})
        records = data_df.to_dict(orient="records")

        # Türkiye geneli özet istatistikler
        accrual_sum = data_df['tahakkuk'].sum(skipna=True) if data_df['tahakkuk'].any() else 0
        collection_sum = data_df['tahsilat'].sum(skipna=True) if data_df['tahsilat'].any() else 0
        overall_ratio = (collection_sum / accrual_sum * 100) if accrual_sum else 0

        # Frontend için standart alan isimlerine eşleştir
        mapped_records = []
        for r in records:
            accrual = r["tahakkuk"]
            collection = r["tahsilat"]

            # Recalculate ratio dynamically to avoid excel formula errors or NaNs
            if accrual is not None and accrual > 0:
                val_coll = collection if collection is not None else 0.0
                ratio = round((val_coll / accrual) * 100, 2)
            elif accrual is not None and accrual == 0 and collection is not None and collection > 0:
                ratio = 100.0
            else:
                excel_ratio = r["tahsilat/tahakkuk"]
                if excel_ratio is not None and not (isinstance(excel_ratio, (int, float)) and np.isnan(excel_ratio)):
                    ratio = float(excel_ratio)
                else:
                    ratio = 0.0

            mapped_records.append({
                "province": r["İl"],
                "accrual": accrual,
                "collection": collection,
                "ratio": ratio
            })

        return {
            "year": year,
            "category": category,
            "summary": {
                "total_accrual": float(accrual_sum),
                "total_collection": float(collection_sum),
                "overall_ratio": float(round(overall_ratio, 2))
            },
            "data": mapped_records
        }
    except Exception:
        logger.exception("Veriler işlenirken hata oluştu (year=%s, category=%r)", year, category)
        raise HTTPException(status_code=500, detail="Veriler işlenirken hata oluştu.")

@app.get("/api/geojson")
async def get_geojson():
    """
    Türkiye coğrafi sınırlarını gösteren GeoJSON verisini döner.
    """
    geojson_path = lib.VERILER_DIR / "tr.json"
    if not geojson_path.exists():
        raise HTTPException(status_code=404, detail="GeoJSON harita dosyası bulunamadı.")
    try:
        def _read_geojson():
            with open(geojson_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return await run_in_threadpool(_read_geojson)
    except Exception:
        logger.exception("GeoJSON okuma hatası")
        raise HTTPException(status_code=500, detail="GeoJSON okuma hatası.")

@app.post("/api/scrape")
async def trigger_scrape(year_input: str, background_tasks: BackgroundTasks):
    """
    Arka planda paralel veri çekme/güncelleme işlemini başlatır.
    """
    _validate_year_input(year_input)
    background_tasks.add_task(run_scraper_bg, year_input)
    return {
        "status": "started",
        "message": f"Arka planda '{year_input}' yılları için veri çekme işlemi başlatıldı."
    }
