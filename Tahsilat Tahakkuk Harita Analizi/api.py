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
    title="Tahsilat Tahakkuk Harita Analiz API",
    description="İl bazında vergi gelirleri tahsilat-tahakkuk ve oran analizlerini sunan backend servisi.",
    version="1.0.0"
)

# CORS ayarları - Yeni Frontend uygulamalarının (React, Next.js vb.) bağlanabilmesi için
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
        if stderr:
            print(f"⚠️ Hata Çıktısı: {stderr[:200]}...")
    except Exception as e:
        print(f"❌ Arka plan veri çekici hatası: {e}")

@app.get("/")
def read_root():
    return {
        "status": "online",
        "message": "Tahsilat Tahakkuk Harita Analiz API aktif durumda.",
        "endpoints": {
            "GET /api/years": "Mevcut yılları listeler",
            "GET /api/categories?year=2025": "Yıla ait gelir kalemlerini listeler",
            "GET /api/data?year=2025&category=Özel Tüketim Vergisi": "Yıl ve kalem bazlı ham il verilerini listeler",
            "GET /api/map/amount?year=2025&category=Özel Tüketim Vergisi&type=tahsilat": "İl miktar haritasını Plotly JSON olarak döner",
            "GET /api/map/ratio?year=2025&category=Özel Tüketim Vergisi": "İl oran haritasını Plotly JSON olarak döner",
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

@app.get("/api/categories")
def get_categories(year: int):
    """
    Seçilen yıla ait mevcut vergi gelir kalemlerini (kategorileri) listeler.
    """
    folder_name = f"İllere Göre Tahsilat Tahakkuk {year}"
    folder_path = os.path.join(lib.ana_klasor, folder_name)
    
    if not os.path.exists(folder_path):
        raise HTTPException(status_code=404, detail=f"{year} yılına ait veri klasörü bulunamadı.")

    excel_files = [f for f in os.listdir(folder_path) if f.endswith('.xlsx')]
    if not excel_files:
        raise HTTPException(status_code=404, detail=f"{year} yılına ait veri dosyaları bulunamadı.")

    dosya_yolu = os.path.join(folder_path, excel_files[0])
    try:
        df = pd.read_excel(dosya_yolu, skiprows=2)
        df = df.drop(index=0)
        df = df.drop(columns=['Unnamed: 0'], errors='ignore')
        df.columns = ['index', 'tahakkuk', 'tahsilat', 'tahsilat/tahakkuk']
        categories = [str(i).strip() for i in df['index'] if isinstance(i, str)]
        
        cleaned_categories = []
        for cat in categories:
            clean_name = re.sub(r"^\d+\.\s*", "", cat).title()
            cleaned_categories.append({"id": cat, "name": clean_name})
            
        return {"year": year, "categories": cleaned_categories}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kategoriler okunurken hata oluştu: {str(e)}")

@app.get("/api/data")
def get_data(year: int, category: str):
    """
    Belirli bir yıl ve vergi kalemi için 81 ilin tahakkuk, tahsilat ve oran verilerini döner.
    """
    folder_name = f"İllere Göre Tahsilat Tahakkuk {year}"
    folder_path = os.path.join(lib.ana_klasor, folder_name)
    
    if not os.path.exists(folder_path):
        raise HTTPException(status_code=404, detail=f"{year} yılına ait veri klasörü bulunamadı.")

    try:
        iller_dict, _ = lib.excel_dosyalarini_oku(folder_path)
        merged = lib.veri_hazirla(iller_dict, category)
        
        # Coğrafi verileri çıkararak sade bir veri DataFrame'i oluştur
        data_df = pd.DataFrame(merged.drop(columns=['geometry'], errors='ignore'))
        data_df = data_df[['İl', 'tahakkuk', 'tahsilat', 'tahsilat/tahakkuk']]
        data_df.columns = ['province', 'accrual', 'collection', 'ratio']
        data_df = data_df.replace({np.nan: None})
        
        records = data_df.to_dict(orient="records")
        
        # Türkiye geneli özet istatistikler
        accrual_sum = data_df['accrual'].sum(skipna=True) if data_df['accrual'].any() else 0
        collection_sum = data_df['collection'].sum(skipna=True) if data_df['collection'].any() else 0
        overall_ratio = (collection_sum / accrual_sum * 100) if accrual_sum else 0
        
        return {
            "year": year,
            "category": category,
            "summary": {
                "total_accrual": float(accrual_sum),
                "total_collection": float(collection_sum),
                "overall_ratio": float(round(overall_ratio, 2))
            },
            "data": records
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Veriler işlenirken hata oluştu: {str(e)}")

@app.get("/api/map/amount")
def get_map_amount(year: int, category: str, type: str = "tahsilat"):
    """
    Plotly formatında miktar (tahsilat veya tahakkuk) haritası nesnesi döner.
    Geri dönen JSON nesnesi doğrudan frontend'deki Plotly.js kütüphanesiyle render edilebilir.
    """
    if type not in ("tahsilat", "tahakkuk"):
        raise HTTPException(status_code=400, detail="Tip parametresi 'tahsilat' veya 'tahakkuk' olmalıdır.")

    folder_name = f"İllere Göre Tahsilat Tahakkuk {year}"
    folder_path = os.path.join(lib.ana_klasor, folder_name)
    
    if not os.path.exists(folder_path):
        raise HTTPException(status_code=404, detail=f"{year} yılı verisi bulunamadı.")

    try:
        iller_dict, _ = lib.excel_dosyalarini_oku(folder_path)
        merged = lib.veri_hazirla(iller_dict, category)
        
        title = f"{year} İllere Göre {category} {type.capitalize()}ı (Milyar TL)"
        fig = lib.ciz_interaktif_miktar_harita(merged, type, title, renk_olcegi="Viridis")
        
        return json.loads(fig.to_json())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Harita çizilirken hata oluştu: {str(e)}")

@app.get("/api/map/ratio")
def get_map_ratio(year: int, category: str):
    """
    Plotly formatında tahsilat/tahakkuk oran haritası nesnesi döner.
    """
    folder_name = f"İllere Göre Tahsilat Tahakkuk {year}"
    folder_path = os.path.join(lib.ana_klasor, folder_name)
    
    if not os.path.exists(folder_path):
        raise HTTPException(status_code=404, detail=f"{year} yılı verisi bulunamadı.")

    try:
        iller_dict, _ = lib.excel_dosyalarini_oku(folder_path)
        merged = lib.veri_hazirla(iller_dict, category)
        
        title = f"{year} İllere Göre {category} Tahsilat Oranı (%)"
        fig = lib.ciz_interaktif_oran_harita(merged, title, renk_olcegi="RdYlGn")
        
        return json.loads(fig.to_json())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Harita çizilirken hata oluştu: {str(e)}")

@app.post("/api/scrape")
def trigger_scrape(year_input: str, background_tasks: BackgroundTasks):
    """
    Arka planda paralel veri çekme/güncelleme işlemini başlatır.
    İşlem asenkron olarak arka planda çalışırken anında istek yanıtlanır.
    """
    background_tasks.add_task(run_scraper_bg, year_input)
    return {
        "status": "started",
        "message": f"Arka planda '{year_input}' yılları için veri çekme işlemi başlatıldı."
    }
