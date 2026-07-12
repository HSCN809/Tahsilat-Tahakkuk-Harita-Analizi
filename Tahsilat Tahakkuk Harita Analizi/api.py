import os
import re
import json
import sys
import hmac
import logging
import subprocess
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime, timezone
from fastapi import FastAPI, Header, HTTPException, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

# api.py dosyasının bulunduğu dizini Python sistem yoluna ekle (İçe aktarmaların sorunsuz çalışması için)
CURRENT_DIR = Path(__file__).resolve().parent
sys.path.append(str(CURRENT_DIR))

# Kütüphane modülünü import et
import Tahsilat_Tahakkuk_Grafik_Olusturma_Projesi as lib
import job_manager
import backup

logger = logging.getLogger("api")


class _JsonFormatter(logging.Formatter):
    """Loki dostu, tek satırlık JSON log formatı."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)


_configure_logging()

# GeoJSON statik dosya — modül seviyesinde bir kez yüklenir, her istekte diskten okunmaz
_geojson_cache: dict | None = None


def _load_geojson():
    """tr.json dosyasını bir kez belleğe yükler, sonraki çağrılarda cache'den döner.
    tr.json kodla birlikte gelir, volume altında değildir — veri kaybı olmaz."""
    global _geojson_cache
    if _geojson_cache is not None:
        return _geojson_cache
    # Önce kod dizininde ara (volume mount'tan etkilenmez)
    geojson_path = CURRENT_DIR / "tr.json"
    if not geojson_path.exists():
        # Fallback: veriler/ altında
        geojson_path = lib.VERILER_DIR / "tr.json"
    if not geojson_path.exists():
        raise FileNotFoundError("tr.json bulunamadı")
    with open(geojson_path, "r", encoding="utf-8") as f:
        _geojson_cache = json.load(f)
    return _geojson_cache


# --- /api/scrape güvenliği: ortamdan okunan shared secret ---
SCRAPE_TOKEN = os.environ.get("SCRAPE_TOKEN", "").strip()
BACKUP_DIR = os.environ.get("BACKUP_DIR", "").strip()


def require_scrape_token(authorization: str | None = Header(default=None)) -> None:
    """
    /api/scrape gibi yazma işlemlerini korur.
    İstek başlığında `Authorization: Bearer <SCRAPE_TOKEN>` bekler.
    SCRAPE_TOKEN tanımsızsa servis kasıtlı olarak 503 döner (kimlik doğrulama devre dışı bırakılamaz).
    """
    if not SCRAPE_TOKEN:
        logger.error("SCRAPE_TOKEN tanımlı değil; /api/scrape devre dışı.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sunucu yapılandırması eksik: SCRAPE_TOKEN tanımlı değil.",
        )
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Yetkilendirme başlığı eksik.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Yalnızca Bearer şeması desteklenir.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not hmac.compare_digest(token, SCRAPE_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Geçersiz token.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# --- CORS ---
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:8000,http://127.0.0.1:5173"
    ).split(",") if o.strip()
]

app = FastAPI(
    title="Tahsilat Tahakkuk Veri API",
    description="İl bazında vergi gelirleri tahsilat-tahakkuk ve oran analizlerini sunan backend servisi.",
    version="2.0.0",
    # /docs, /redoc, /openapi.json üretimde tamamen kapatıldı.
    # Geliştirme sırasında erişim için `uvicorn` + `--reload` ile dev compose kullanın.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

# --- Input validation yardımcıları ---
_MIN_YEAR = 2000
_MAX_YEAR = 2100

_YEAR_INPUT_RE = re.compile(r"^(hepsi|\d{4}(-\d{4})?(,\d{4}(-\d{4})?)*)$", re.IGNORECASE)


def _validate_year(year: int) -> None:
    if not (_MIN_YEAR <= year <= _MAX_YEAR):
        raise HTTPException(status_code=400, detail=f"Geçersiz yıl: {year}. Yıl {_MIN_YEAR}-{_MAX_YEAR} aralığında olmalı.")


def _validate_year_input(year_input: str) -> None:
    if not year_input or not _YEAR_INPUT_RE.match(year_input.strip()):
        raise HTTPException(
            status_code=400,
            detail="Geçersiz yıl formatı. Örnekler: 2024, 2024-2025, 2024-2025,2023, hepsi"
        )


def _run_scraper(year_input: str) -> None:
    """
    Senkron scraper çağrısı. job_manager tek-aktif-iş garantisini verir,
    burada yalnızca subprocess çalıştırılır.
    """
    script_path = CURRENT_DIR / "Hazine_Maliye_Bakanlığı_Sitesinden_Excel_Dosyalarını_Çekme.py"
    logger.info("Veri çekme başlatıldı: %r", year_input)
    process = subprocess.Popen(
        [sys.executable, str(script_path), year_input],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        bufsize=1,
    )
    # Canli log: scraper ciktisini satir satir okuyup log'a yaz
    all_output = []
    for line in process.stdout:
        line = line.rstrip()
        all_output.append(line)
        logger.info("[scraper] %s", line)
    process.wait()

    combined = "\n".join(all_output)
    if process.returncode != 0:
        logger.error("Scraper başarısız (rc=%s)", process.returncode)
        raise RuntimeError(f"Scraper başarısız oldu (rc={process.returncode}): {combined}")
    logger.info("Scraper tamamlandı. Toplam %s satir cikti.", len(all_output))
    lib.clear_cache()


def _make_backup() -> str | None:
    if not BACKUP_DIR:
        logger.warning("BACKUP_DIR tanımsız; yedek alınmadı.")
        return None
    snapshot_path = backup.take_snapshot(lib.VERILER_DIR, BACKUP_DIR)
    logger.info("Yedek oluşturuldu: %s", snapshot_path)
    return snapshot_path


@app.get("/health")
def health_check():
    """Kimlik doğrulaması gerektirmeyen sağlık kontrolü endpoint'i.
    Railway ve Docker healthcheck tarafından kullanılır."""
    return {"status": "healthy"}


@app.get("/healthz")
def healthz():
    """/health ile aynı işlevi gören alternatif sağlık kontrolü endpoint'i.
    Bazı platformlar (Railway, Kubernetes) /healthz yolunu standart kabul eder."""
    return {"status": "healthy"}


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
            "GET /api/jobs/status": "Aktif/son scrape işinin durumunu döner",
            "POST /api/scrape?year_input=2024-2025": "Arka planda veri indirmeyi başlatır (token gerekir)",
        },
    }


@app.get("/api/years")
async def get_years():
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
    cached = lib._config_cache.get(year)
    if cached is not None:
        logger.debug("Config önbellekten getirildi: yıl %s", year)
        return cached

    folder_path = lib.get_year_folder_path(year)

    if not os.path.exists(folder_path):
        raise FileNotFoundError(f"{year} yılına ait veri klasörü bulunamadı.")

    il_dirs = [
        d for d in os.listdir(folder_path)
        if os.path.isdir(os.path.join(folder_path, d)) and re.match(r"^\d{2}_", d)
    ]
    mevcut_aylar: list[str] = []
    if il_dirs:
        ilk_il_klasoru = os.path.join(folder_path, il_dirs[0])
        aylik_dosyalar = [f for f in os.listdir(ilk_il_klasoru) if f.endswith('.xlsx')]
        aylar = [os.path.splitext(f)[0] for f in aylik_dosyalar]
        aylar_lower = [a.lower() for a in aylar]
        mevcut_aylar = [ay for ay in lib.AY_SIRALAMASI if ay.lower() in aylar_lower]

    # Kategorileri ilk ilin ilk ay Excel'inden oku
    # (scraper verileri il alt klasörlerine yazar: 01_Adana/Ocak.xlsx)
    cleaned_categories: list[dict] = []
    if il_dirs and mevcut_aylar:
        ilk_il = il_dirs[0]
        ilk_ay = mevcut_aylar[0]
        kategori_dosyasi = os.path.join(folder_path, ilk_il, f"{ilk_ay}.xlsx")
        try:
            df_raw = pd.read_excel(kategori_dosyasi)
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
            logger.warning("Kategori okunamadi (yil=%s): %s", year, exc_info=True)
            pass

    result = {
        "year": year,
        "months": mevcut_aylar,
        "categories": cleaned_categories
    }
    lib._config_cache.set(year, result)
    return result


@app.get("/api/config")
async def get_config(year: int):
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
    _validate_year(year)
    folder_path = lib.get_year_folder_path(year)

    if not os.path.exists(folder_path):
        raise HTTPException(status_code=404, detail=f"{year} yılına ait veri klasörü bulunamadı.")

    try:
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

        accrual_sum = data_df['tahakkuk'].sum(skipna=True) if data_df['tahakkuk'].any() else 0
        collection_sum = data_df['tahsilat'].sum(skipna=True) if data_df['tahsilat'].any() else 0
        overall_ratio = (collection_sum / accrual_sum * 100) if accrual_sum else 0

        mapped_records = []
        for r in records:
            accrual = r["tahakkuk"]
            collection = r["tahsilat"]

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
    try:
        return await run_in_threadpool(_load_geojson)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="GeoJSON harita dosyası bulunamadı.")
    except Exception:
        logger.exception("GeoJSON okuma hatası")
        raise HTTPException(status_code=500, detail="GeoJSON okuma hatası.")


@app.get("/api/jobs/status")
async def get_job_status():
    """Aktif veya son tamamlanan scrape işinin durumunu döner."""
    current = job_manager.job_manager.current()
    if current is None:
        return {"running": False, "last_job": None}
    running = current.get("status") == "running"
    return {"running": running, "last_job": current}


@app.post("/api/scrape", dependencies=[Depends(require_scrape_token)])
async def trigger_scrape(year_input: str):
    """
    Arka planda paralel veri çekme/güncelleme işlemini başlatır.
    Yetkilendirme: `require_scrape_token` dependency ile sağlanır.
    Aynı anda yalnızca bir iş çalışabilir (job_manager).
    """
    _validate_year_input(year_input)

    started, info = job_manager.job_manager.submit(
        year_input,
        runner=lambda job: _run_scraper(job.year_input),
        backup_notifier=_make_backup,
    )

    if not started:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Zaten çalışan bir scrape işi var. Lütfen mevcut işin bitmesini bekleyin.",
        )

    return {
        "status": "started",
        "job_id": info["job_id"],
        "message": f"Arka planda '{year_input}' yılları için veri çekme işi başlatıldı.",
    }
