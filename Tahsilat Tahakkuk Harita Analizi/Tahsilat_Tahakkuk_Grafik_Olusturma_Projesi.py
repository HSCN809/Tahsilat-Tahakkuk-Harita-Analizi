import os
import re
import json
import pandas as pd
import numpy as np
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# xlrd kütüphanesini Türkçe ve bozuk karakter hatalarını yok sayması için yamala (monkey patch)
import xlrd
xlrd.biffh.unicode = lambda b, enc: b.decode(enc, 'replace')
xlrd.book.unicode = lambda b, enc: b.decode(enc, 'replace')
xlrd.formatting.unicode = lambda b, enc: b.decode(enc, 'replace')

BASE_DIR = Path(__file__).resolve().parent

# 'veriler' klasörünü bul
for candidate in [BASE_DIR / "veriler", BASE_DIR.parent / "veriler", Path.cwd() / "veriler"]:
    if candidate.exists():
        VERILER_DIR = candidate
        break
else:
    raise FileNotFoundError("❌ 'veriler' klasörü bulunamadı (repo kökünde olmalı).")

# Excel ana klasörünü bul
olasi_adlar = [
    "Tahsilat Tahakkuk Excel Dosyaları",
    "İllere Göre Tahsilat Tahakkuk (Yıllara Göre)",
]

ana_klasor = None
for name in olasi_adlar:
    p = VERILER_DIR / name
    if p.exists():
        ana_klasor = p
        break

if ana_klasor is None:
    for p in VERILER_DIR.iterdir():
        if p.is_dir() and any(c.name.startswith("İllere Göre Tahsilat Tahakkuk") for c in p.iterdir() if c.is_dir()):
            ana_klasor = p
            break

if ana_klasor is None:
    raise FileNotFoundError("❌ Excel klasörü bulunamadı. 'veriler' içindeki klasör adlarını kontrol edin.")

def kolonlari_ayarla(df_raw, header_row_idx):
    header_row = [str(val).lower().strip() for val in df_raw.iloc[header_row_idx].tolist()]
    
    tahakkuk_idx = None
    tahsilat_idx = None
    ratio_idx = None
    
    for i, val in enumerate(header_row):
        if "/" in val or "oran" in val or ("tahakkuk" in val and "tahsilat" in val):
            ratio_idx = i
        elif "tahakkuk" in val:
            tahakkuk_idx = i
        elif "tahsilat" in val:
            tahsilat_idx = i
                
    if ratio_idx is None and tahsilat_idx is not None and tahsilat_idx + 1 < len(header_row):
        ratio_idx = tahsilat_idx + 1
        
    if tahakkuk_idx is None or tahsilat_idx is None:
        return None
        
    index_idx = tahakkuk_idx - 1
    df = df_raw.iloc[header_row_idx + 1:].copy()
    
    if ratio_idx is not None and ratio_idx < df_raw.shape[1]:
        df = df.iloc[:, [index_idx, tahakkuk_idx, tahsilat_idx, ratio_idx]]
    else:
        df = df.iloc[:, [index_idx, tahakkuk_idx, tahsilat_idx]]
        df['tahsilat/tahakkuk'] = None
        
    df.columns = ['index', 'tahakkuk', 'tahsilat', 'tahsilat/tahakkuk']
    return df

def oku_ve_temizle_tek_dosya(dosya_adi, folder_path):
    """
    Tek bir Excel dosyasını dinamik satır tespiti yaparak okuyup temizler.
    """
    match = re.match(r"(.+?)_(\d{4})\.xlsx", dosya_adi)
    if not match:
        return None
        
    il_kodlu, yil = match.groups()
    il_adi = "_".join(il_kodlu.split("_")[1:]) if "_" in il_kodlu else il_kodlu
    dosya_yolu = os.path.join(folder_path, dosya_adi)
    try:
        df_raw = pd.read_excel(dosya_yolu)
        
        # Başlık satırını bul (Tahakkuk ve Tahsilat içeren satır)
        header_row_idx = None
        for idx in range(len(df_raw)):
            row_values = [str(val).lower().strip() for val in df_raw.iloc[idx].tolist()]
            if any("tahakkuk" in val for val in row_values) and any("tahsilat" in val for val in row_values):
                header_row_idx = idx
                break
                
        if header_row_idx is None:
            return None
            
        df = kolonlari_ayarla(df_raw, header_row_idx)
        if df is None:
            return None
            
        df.set_index('index', inplace=True)
        
        for col in ['tahakkuk', 'tahsilat', 'tahsilat/tahakkuk']:
            df[col] = pd.to_numeric(df[col], errors="coerce")
            
        # Boş satırları filtrele
        df = df.dropna(subset=['tahakkuk', 'tahsilat'], how='all')
        
        return il_adi, int(yil), df
    except Exception:
        return None

def oku_ve_temizle_aylik_dosya(folder_name, month, parent_folder_path, yil):
    """
    Belirli bir il klasörü içindeki aylık Excel dosyasını okur.
    """
    il_adi = "_".join(folder_name.split("_")[1:]) if "_" in folder_name else folder_name
    dosya_yolu = os.path.join(parent_folder_path, folder_name, f"{month}.xlsx")
    if not os.path.exists(dosya_yolu):
        return None
    try:
        df_raw = pd.read_excel(dosya_yolu)
        
        # Başlık satırını bul
        header_row_idx = None
        for idx in range(len(df_raw)):
            row_values = [str(val).lower().strip() for val in df_raw.iloc[idx].tolist()]
            if any("tahakkuk" in val for val in row_values) and any("tahsilat" in val for val in row_values):
                header_row_idx = idx
                break
                
        if header_row_idx is None:
            return None
            
        df = kolonlari_ayarla(df_raw, header_row_idx)
        if df is None:
            return None
            
        df.set_index('index', inplace=True)
        
        for col in ['tahakkuk', 'tahsilat', 'tahsilat/tahakkuk']:
            df[col] = pd.to_numeric(df[col], errors="coerce")
            
        df = df.dropna(subset=['tahakkuk', 'tahsilat'], how='all')
        return il_adi, int(yil), df
    except Exception:
        return None

_excel_cache = {}

def clear_cache():
    global _excel_cache
    _excel_cache.clear()
    print("🧹 Excel veri önbelleği temizlendi.")

def excel_dosyalarini_oku(folder_path, month=None):
    """
    Klasördeki tüm il Excel dosyalarını (yıllık veya belirli bir aya ait) paralel olarak okur.
    Bellek içi önbellekleme kullanır.
    """
    cache_key = (str(folder_path), month)
    if cache_key in _excel_cache:
        print(f"💾 Veriler önbellekten getirildi: {cache_key}")
        return _excel_cache[cache_key]

    match_yil = re.search(r"(\d{4})", str(folder_path))
    yil = int(match_yil.group(1)) if match_yil else 0

    iller_dict = {}
    yillar = []

    if month and month != "Yıl Geneli":
        # Aylık veriyi oku
        il_klasorleri = sorted([
            d for d in os.listdir(folder_path) 
            if os.path.isdir(os.path.join(folder_path, d)) and re.match(r"^\d{2}_", d)
        ])
        
        with ThreadPoolExecutor(max_workers=16) as executor:
            futures = [
                executor.submit(oku_ve_temizle_aylik_dosya, klasor_adi, month, folder_path, yil)
                for klasor_adi in il_klasorleri
            ]
            
            for future in as_completed(futures):
                res = future.result()
                if res:
                    il_adi, _, df = res
                    iller_dict[il_adi] = df
                    yillar.append(yil)
    else:
        # Yıllık veriyi oku
        excel_dosyalari = sorted(
            [f for f in os.listdir(folder_path) if f.endswith('.xlsx')],
            key=lambda x: int(re.search(r"(\d{4})", x).group(1)) if re.search(r"(\d{4})", x) else 0
        )
        
        with ThreadPoolExecutor(max_workers=16) as executor:
            futures = [
                executor.submit(oku_ve_temizle_tek_dosya, dosya_adi, folder_path)
                for dosya_adi in excel_dosyalari
            ]
            
            for future in as_completed(futures):
                res = future.result()
                if res:
                    il_adi, yil_res, df = res
                    iller_dict[il_adi] = df
                    yillar.append(yil_res)
                    
    _excel_cache[cache_key] = (iller_dict, yillar)
    return iller_dict, yillar

def temizle_metin(text):
    if not isinstance(text, str):
        return ""
    clean = re.sub(r"^\d+\.\s*", "", text.strip(), flags=re.UNICODE).lower()
    return re.sub(r"\s+", " ", clean)

def veri_hazirla(iller_dict, secim):
    """
    İl sözlüğündeki verileri seçilen gelir kalemi (secim) bazında filtreleyip DataFrame'e dönüştürür.
    """
    veri_listesi = []
    for il_adi, df in iller_dict.items():
        try:
            temiz_indexler = {temizle_metin(i): i for i in df.index if isinstance(i, str)}
            secim_clean = temizle_metin(secim)

            if secim_clean not in temiz_indexler:
                continue

            orijinal_satir_adi = temiz_indexler[secim_clean]
            satir = df.loc[orijinal_satir_adi]

            veri_listesi.append({
                "İl": il_adi,
                "tahakkuk": satir["tahakkuk"],
                "tahsilat": satir["tahsilat"],
                "tahsilat/tahakkuk": satir["tahsilat/tahakkuk"]
            })
        except:
            continue

    gelir_df = pd.DataFrame(veri_listesi)
    return gelir_df
