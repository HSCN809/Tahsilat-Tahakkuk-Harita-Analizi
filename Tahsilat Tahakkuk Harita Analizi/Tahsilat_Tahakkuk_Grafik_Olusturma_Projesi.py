import os
import re
import json
import logging
import threading
from collections import OrderedDict
import pandas as pd
import numpy as np
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

# xlrd kütüphanesini Türkçe ve bozuk karakter hatalarını yok sayması için yamala (monkey patch)
import xlrd

# pandas >=1.5.x, xlrd için 2.0.1 minimum sürümünü zorunlu kılar; ancak xlrd 2.x
# .xls (BIFF) desteğini kaldırdığı için eski HMB .xls dosyalarını okuyamayız.
# xlrd 1.2.0 ile .xls okumaya devam etmek için pandas'ın sürüm kontrolünü bypass et.
import pandas.compat._optional as _pd_opt
_pd_opt.VERSIONS["xlrd"] = "1.2.0"


def safe_decode(b, enc):
    """Çok katmanlı güvenli byte decode: önce istenen encoding, sonra utf-8, en son latin1."""
    try:
        return b.decode(enc, 'replace')
    except Exception:
        try:
            return b.decode('utf-8', 'replace')
        except Exception:
            return b.decode('latin1', 'replace')


xlrd.biffh.unicode = safe_decode
xlrd.book.unicode = safe_decode
xlrd.formatting.unicode = safe_decode

BASE_DIR = Path(__file__).resolve().parent

# 'veriler' klasörünü bul; yoksa otomatik oluştur (ilk çalıştırmada).
# Öncelik sırası: repo kökü (parent), sonra cwd, en son script dizini.
for candidate in [BASE_DIR.parent / "veriler", Path.cwd() / "veriler", BASE_DIR / "veriler"]:
    candidate.mkdir(parents=True, exist_ok=True)
    VERILER_DIR = candidate
    break

# Excel ana klasörünü bul; yoksa varsayılan adla oluştur (scraper buraya yazar)
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
    ana_klasor = VERILER_DIR / olasi_adlar[0]
    ana_klasor.mkdir(parents=True, exist_ok=True)

# --- Paylaşılan sabitler (api.py ve scraper tarafından import edilir) ---
FOLDER_NAME_TEMPLATE = "İllere Göre Tahsilat Tahakkuk {year}"
AY_SIRALAMASI = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]


def get_year_folder_path(year):
    """Verilen yıl için ana klasör altındaki veri klasörünün yolunu döner."""
    return os.path.join(ana_klasor, FOLDER_NAME_TEMPLATE.format(year=year))


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

def oku_ve_temizle_dosya(dosya_yolu, il_adi, yil, log_etiket=None):
    """
    Tek bir Excel dosyasını dinamik satır tespiti yaparak okuyup temizler.
    Yıllık ve aylık dosyalar için ortak kullanılır.

    Parametreler:
      dosya_yolu: Okunacak .xlsx dosyasının tam yolu
      il_adi: Dönecek sonucun il adı etiketi
      yil: Dönecek sonucun yıl değeri
      log_etiket: Hata loglarında görünecek dosya tanımlayıcısı (opsiyonel)
    """
    etiket = log_etiket or il_adi
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
        logger.warning("Excel dosyası okunamadı: %s", etiket, exc_info=True)
        return None


def oku_ve_temizle_tek_dosya(dosya_adi, folder_path):
    """Yıllık Excel dosyası için wrapper — dosya adından il+yıl çıkarır."""
    match = re.match(r"(.+?)_(\d{4})\.xlsx", dosya_adi)
    if not match:
        return None

    il_kodlu, yil = match.groups()
    il_adi = "_".join(il_kodlu.split("_")[1:]) if "_" in il_kodlu else il_kodlu
    dosya_yolu = os.path.join(folder_path, dosya_adi)
    return oku_ve_temizle_dosya(dosya_yolu, il_adi, yil, log_etiket=dosya_adi)


def oku_ve_temizle_aylik_dosya(folder_name, month, parent_folder_path, yil):
    """Aylık Excel dosyası için wrapper — il klasörü altından ay dosyasını okur."""
    il_adi = "_".join(folder_name.split("_")[1:]) if "_" in folder_name else folder_name
    dosya_yolu = os.path.join(parent_folder_path, folder_name, f"{month}.xlsx")
    if not os.path.exists(dosya_yolu):
        return None
    return oku_ve_temizle_dosya(dosya_yolu, il_adi, yil, log_etiket=f"{folder_name}/{month}")

class LRUCache:
    """
    Thread-safe LRU (Least Recently Used) önbellek.
    Eşzamanlı erişimde güvenli ve bellek kullanımı sınırlı.
    """
    def __init__(self, maxsize: int = 32):
        self._data: OrderedDict = OrderedDict()
        self._lock = threading.RLock()
        self.maxsize = maxsize

    def get(self, key):
        with self._lock:
            if key not in self._data:
                return None
            # En son kullanılanı sona taşı (LRU sıralaması)
            self._data.move_to_end(key)
            return self._data[key]

    def set(self, key, value):
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
            self._data[key] = value
            # maxsize aşılırsa en eski (en az kullanılan) entry'i at
            if len(self._data) > self.maxsize:
                self._data.popitem(last=False)

    def clear(self):
        with self._lock:
            self._data.clear()

    def __contains__(self, key):
        with self._lock:
            return key in self._data

    def __getitem__(self, key):
        with self._lock:
            return self._data[key]

    def __len__(self):
        with self._lock:
            return len(self._data)


_excel_cache = LRUCache(maxsize=32)
_config_cache = LRUCache(maxsize=32)

# Modül seviyesi tek thread havuzu — her çağrıda yeniden yaratma maliyetinden kaçınır
import atexit
_executor = ThreadPoolExecutor(max_workers=16)
atexit.register(_executor.shutdown)

def clear_cache():
    _excel_cache.clear()
    _config_cache.clear()
    logger.info("Excel veri ve config önbelleği temizlendi.")

def excel_dosyalarini_oku(folder_path, month=None):
    """
    Klasördeki tüm il Excel dosyalarını (yıllık veya belirli bir aya ait) paralel olarak okur.
    Bellek içi önbellekleme kullanır.
    """
    cache_key = (str(folder_path), month)
    cached = _excel_cache.get(cache_key)
    if cached is not None:
        logger.debug("Veriler önbellekten getirildi: %s", cache_key)
        return cached

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

        futures = [
            _executor.submit(oku_ve_temizle_aylik_dosya, klasor_adi, month, folder_path, yil)
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

        futures = [
            _executor.submit(oku_ve_temizle_tek_dosya, dosya_adi, folder_path)
            for dosya_adi in excel_dosyalari
        ]

        for future in as_completed(futures):
            res = future.result()
            if res:
                il_adi, yil_res, df = res
                iller_dict[il_adi] = df
                yillar.append(yil_res)

    _excel_cache.set(cache_key, (iller_dict, yillar))
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
        except Exception:
            logger.debug("İl verisi hazırlanırken hata atlandı: %s", il_adi, exc_info=True)
            continue

    gelir_df = pd.DataFrame(veri_listesi)
    return gelir_df
