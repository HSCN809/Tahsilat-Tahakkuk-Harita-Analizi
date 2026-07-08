import os
import re
import json
import sys
import subprocess
import pandas as pd
import numpy as np
from pathlib import Path
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# api.py dosyasının bulunduğu dizini Python sistem yoluna ekle (İçe aktarmaların sorunsuz çalışması için)
CURRENT_DIR = Path(__file__).resolve().parent
sys.path.append(str(CURRENT_DIR))

# Kütüphane modülünü import et
import Tahsilat_Tahakkuk_Grafik_Olusturma_Projesi as lib

app = FastAPI(
    title="Tahsilat Tahakkuk Veri API",
    description="İl bazında vergi gelirleri tahsilat-tahakkuk ve oran analizlerini sunan backend servisi.",
    version="2.0.0"
)

# CORS ayarları
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def run_scraper_bg(year_input: str):
    """
    Arka planda veri çekme scriptini çalıştırır.
    """
    script_path = CURRENT_DIR / "Hazine_Maliye_Bakanlığı_Sitesinden_Excel_Dosyalarını_Çekme.py"
    try:
        print(f"🚀 Arka plan veri çekme işlemi başlatıldı: '{year_input}'")
        process = subprocess.Popen(
            [sys.executable, str(script_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8"
        )
        stdout, stderr = process.communicate(input=year_input + "\n")
        print(f"✅ Arka plan veri çekici tamamlandı. Çıktı: {stdout[:200]}...")
        # Önbelleği temizle ki yeni veriler yüklensin
        lib.clear_cache()
        if stderr:
            print(f"⚠️ Hata Çıktısı: {stderr[:200]}...")
    except Exception as e:
        print(f"❌ Arka plan veri çekici hatası: {e}")

@app.get("/")
def read_root():
    return {
        "status": "online",
        "message": "Tahsilat Tahakkuk Veri API aktif durumda.",
        "endpoints": {
            "GET /api/years": "Mevcut yılları listeler",
            "GET /api/categories?year=2025": "Yıla ait gelir kalemlerini listeler",
            "GET /api/data?year=2025&category=Özel Tüketim Vergisi": "Yıl ve kalem bazlı ham il verilerini listeler",
            "GET /api/geojson": "Türkiye sınırları GeoJSON dosyasını döner",
            "POST /api/scrape?year_input=2024-2025": "Arka planda veri indirmeyi başlatır"
        }
    }

@app.get("/api/years")
def get_years():
    """
    Klasörde mevcut yılları tespit edip listeler.
    """
    try:
        alt_klasorler = sorted(
            [f for f in os.listdir(lib.ana_klasor) if os.path.isdir(os.path.join(lib.ana_klasor, f))],
            key=lambda x: int(re.search(r"\d{4}", x).group(0)) if re.search(r"\d{4}", x) else 0
        )
        years = []
        for folder in alt_klasorler:
            match = re.search(r"\d{4}", folder)
            if match:
                years.append(int(match.group(0)))
        return {"years": sorted(list(set(years)))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Yıllar listelenirken hata oluştu: {str(e)}")

@app.get("/api/config")
def get_config(year: int):
    """
    Seçilen yıla ait aylar ve kategorileri TEK bir istekle döner.
    Frontend yıl değiştiğinde sadece bu endpoint'i çağırır.
    """
    folder_name = f"İllere Göre Tahsilat Tahakkuk {year}"
    folder_path = os.path.join(lib.ana_klasor, folder_name)

    if not os.path.exists(folder_path):
        raise HTTPException(status_code=404, detail=f"{year} yılına ait veri klasörü bulunamadı.")

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

    return {
        "year": year,
        "months": mevcut_aylar,
        "categories": cleaned_categories
    }

@app.get("/api/months")
def get_months(year: int):
    """
    Belirli bir yıla ait veri klasöründeki mevcut ayları listeler.
    """
    folder_name = f"İllere Göre Tahsilat Tahakkuk {year}"
    folder_path = os.path.join(lib.ana_klasor, folder_name)
    
    if not os.path.exists(folder_path):
        return {"year": year, "months": []}

    # İl klasörlerini tespit et (örn: 01_Adana)
    il_dirs = [
        d for d in os.listdir(folder_path)
        if os.path.isdir(os.path.join(folder_path, d)) and re.match(r"^\d{2}_", d)
    ]

    if not il_dirs:
        return {"year": year, "months": []}
        
    # İlk il klasörünün içindeki aylık Excel dosyalarını listele
    ilk_il_klasoru = os.path.join(folder_path, il_dirs[0])
    aylik_dosyalar = [f for f in os.listdir(ilk_il_klasoru) if f.endswith('.xlsx')]
    
    # Dosya adlarından ayları al (.xlsx kısmını at)
    aylar = [os.path.splitext(f)[0] for f in aylik_dosyalar]
    
    # Türkçe ayların sıralaması
    AY_SIRALAMASI = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
    
    # Sadece klasörde mevcut olan ayları sıralı olarak filtrele
    aylar_lower = [a.lower() for a in aylar]
    mevcut_aylar = [ay for ay in AY_SIRALAMASI if ay.lower() in aylar_lower]

    return {"year": year, "months": mevcut_aylar}

@app.get("/api/data")
def get_data(year: int, category: str, month: str = ""):
    """
    Belirli bir yıl, vergi kalemi ve ay için 81 ilin tahakkuk, tahsilat ve oran verilerini döner.
    Ay belirtilmezse (boş) yıllık özet veri kullanılır.
    """
    folder_name = f"İllere Göre Tahsilat Tahakkuk {year}"
    folder_path = os.path.join(lib.ana_klasor, folder_name)
    
    if not os.path.exists(folder_path):
        raise HTTPException(status_code=404, detail=f"{year} yılına ait veri klasörü bulunamadı.")

    try:
        iller_dict, _ = lib.excel_dosyalarini_oku(folder_path, month=month)
        data_df = lib.veri_hazirla(iller_dict, category)
        
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Veriler işlenirken hata oluştu: {str(e)}")

@app.get("/api/geojson")
def get_geojson():
    """
    Türkiye coğrafi sınırlarını gösteren GeoJSON verisini döner.
    """
    geojson_path = lib.VERILER_DIR / "tr.json"
    if not geojson_path.exists():
        raise HTTPException(status_code=404, detail="GeoJSON harita dosyası bulunamadı.")
    try:
        with open(geojson_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GeoJSON okuma hatası: {str(e)}")

@app.post("/api/scrape")
def trigger_scrape(year_input: str, background_tasks: BackgroundTasks):
    """
    Arka planda paralel veri çekme/güncelleme işlemini başlatır.
    """
    background_tasks.add_task(run_scraper_bg, year_input)
    return {
        "status": "started",
        "message": f"Arka planda '{year_input}' yılları için veri çekme işlemi başlatıldı."
    }
