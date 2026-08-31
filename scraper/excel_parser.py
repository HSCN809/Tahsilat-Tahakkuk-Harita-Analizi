import atexit
import json
import logging
import os
import re
import sqlite3
import threading
import unicodedata
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

# xlrd kütüphanesini Türkçe ve bozuk karakter hatalarını yok sayması için yamala (monkey patch)
import pandas.compat._optional as _pd_opt
import xlrd

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

BASE_DIR = Path(__file__).resolve().parent.parent

# 'veriler' klasörünü bul; yoksa otomatik oluştur (ilk çalıştırmada).
for candidate in [BASE_DIR / "veriler", Path.cwd() / "veriler", Path("veriler")]:
    try:
        candidate.mkdir(parents=True, exist_ok=True)
        VERILER_DIR = candidate
        break
    except Exception:
        continue
else:
    VERILER_DIR = Path("veriler")

# Excel ana klasörünü bul; yoksa varsayılan adla oluştur
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
    ana_klasor = VERILER_DIR / olasi_adlar[0]
    try:
        ana_klasor.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

FOLDER_NAME_TEMPLATE = "{year} Yılı İllere Göre Tahsilat Tahakkuk"

AY_SIRALAMASI = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
]


class LRUCache:
    def __init__(self, capacity=50):
        self.capacity = capacity
        self.cache = OrderedDict()
        self.lock = threading.Lock()

    def get(self, key):
        with self.lock:
            if key not in self.cache:
                return None
            self.cache.move_to_end(key)
            return self.cache[key]

    def set(self, key, value):
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
            self.cache[key] = value
            if len(self.cache) > self.capacity:
                self.cache.popitem(last=False)

    def clear(self):
        with self.lock:
            self.cache.clear()


_excel_cache = LRUCache(capacity=60)
_executor = ThreadPoolExecutor(max_workers=8)
atexit.register(_executor.shutdown, wait=False)


def normalize_header(s: str) -> str:
    """Başlık metnini Türkçe karakter ve büyük/küçük harf bağımsız normalize eder."""
    if not isinstance(s, str):
        s = str(s)
    s = s.replace('İ', 'i').replace('I', 'ı').replace('ı', 'i')
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.lower().strip()


def extract_clean_df(df_raw: pd.DataFrame) -> pd.DataFrame | None:
    """
    Excel'den okunan DataFrame'i tahakkuk, tahsilat ve oran kolonlarıyla temizler.
    Başlık satırını, tahakkuk ve tahsilatın AYRI hücrelerde olduğu satırı bularak kesin doğrulukla tespit eder.
    """
    if df_raw is None or df_raw.empty:
        return None

    header_idx = None
    tahakkuk_col = None
    tahsilat_col = None
    oran_col = None

    # 1. Satırlar arasında gerçek başlık satırını ara (uzunluk < 35 olan ayrı hücreler)
    for r_idx in range(min(15, len(df_raw))):
        row = df_raw.iloc[r_idx]
        t_col, s_col, o_col = None, None, None
        for c_idx, val in enumerate(row):
            norm = normalize_header(val)
            if 'tahakkuk' in norm and 'oran' not in norm and '/' not in norm and len(norm) < 35:
                t_col = c_idx
            elif 'tahsilat' in norm and 'oran' not in norm and '/' not in norm and len(norm) < 35:
                s_col = c_idx
            elif ('oran' in norm or '/' in norm or '%' in norm or 'yuzde' in norm) and len(norm) < 35:
                o_col = c_idx

        if t_col is not None and s_col is not None and t_col != s_col:
            header_idx = r_idx
            tahakkuk_col = t_col
            tahsilat_col = s_col
            oran_col = o_col
            break

    # 2. Eğer satırlarda bulunamadıysa df.columns kontrol et
    if header_idx is None:
        t_col, s_col, o_col = None, None, None
        for c_idx, c in enumerate(df_raw.columns):
            norm = normalize_header(c)
            if 'tahakkuk' in norm and 'oran' not in norm and '/' not in norm and len(norm) < 35:
                t_col = c_idx
            elif 'tahsilat' in norm and 'oran' not in norm and '/' not in norm and len(norm) < 35:
                s_col = c_idx
            elif ('oran' in norm or '/' in norm or '%' in norm or 'yuzde' in norm) and len(norm) < 35:
                o_col = c_idx

        if t_col is not None and s_col is not None and t_col != s_col:
            header_idx = -1
            tahakkuk_col = t_col
            tahsilat_col = s_col
            oran_col = o_col

    if header_idx is None or tahakkuk_col is None or tahsilat_col is None:
        return None

    data_rows = df_raw.iloc[header_idx + 1:].copy() if header_idx >= 0 else df_raw.copy()

    # Kategori adını içeren kolonu bul: tahakkuk/tahsilat kolonundan önceki ilk dolu metin kolonu
    cat_col = 0
    for c_idx in range(min(tahakkuk_col, tahsilat_col)):
        non_null_text = data_rows.iloc[:, c_idx].dropna().astype(str)
        valid_items = [t for t in non_null_text if t.strip() and not t.lower().startswith('unnamed') and len(t) > 3]
        if len(valid_items) > 3:
            cat_col = c_idx
            break

    res_df = pd.DataFrame()
    res_df['index'] = data_rows.iloc[:, cat_col].astype(str).str.strip()
    res_df['tahakkuk'] = pd.to_numeric(data_rows.iloc[:, tahakkuk_col], errors='coerce')
    res_df['tahsilat'] = pd.to_numeric(data_rows.iloc[:, tahsilat_col], errors='coerce')

    if oran_col is not None:
        res_df['tahsilat/tahakkuk'] = pd.to_numeric(data_rows.iloc[:, oran_col], errors='coerce')
    else:
        res_df['tahsilat/tahakkuk'] = (res_df['tahsilat'] / res_df['tahakkuk']) * 100

    # Başlık ve geçersiz satırları temizle
    res_df = res_df[~res_df['index'].str.lower().isin(['nan', 'none', '', '(bin tl)', '(ytl)', '(tl)'])]
    res_df = res_df.dropna(subset=['tahakkuk', 'tahsilat'], how='all')
    res_df.set_index('index', inplace=True)
    return res_df


def oku_ve_temizle_tek_dosya(dosya_adi, folder_path):
    dosya_yolu = os.path.join(folder_path, dosya_adi)
    try:
        df_raw = pd.read_excel(dosya_yolu)
        df = extract_clean_df(df_raw)
        if df is None:
            return None

        match_il = re.search(r"^\d{2}_([^_]+)", dosya_adi)
        if not match_il:
            match_il = re.search(r"^[A-Za-zÇĞİÖŞÜçğıöşü\s]+", dosya_adi.replace(".xlsx", ""))
        il_adi = match_il.group(1).replace("_", " ").strip() if match_il else dosya_adi.replace(".xlsx", "").strip()

        match_yil = re.search(r"(\d{4})", dosya_adi)
        yil = int(match_yil.group(1)) if match_yil else 0

        return il_adi, yil, df
    except Exception:
        logger.warning("Dosya okuma hatasi atlandi: %s", dosya_yolu, exc_info=True)
        return None


def oku_ve_temizle_aylik_dosya(klasor_adi, month, folder_path, yil):
    dosya_yolu = os.path.join(folder_path, klasor_adi, f"{month}.xlsx")
    if not os.path.exists(dosya_yolu):
        return None

    try:
        df_raw = pd.read_excel(dosya_yolu)
        df = extract_clean_df(df_raw)
        if df is None:
            return None

        il_adi = "_".join(klasor_adi.split("_")[1:]) if "_" in klasor_adi else klasor_adi
        il_adi = il_adi.replace("_", " ").strip()

        return il_adi, yil, df
    except Exception:
        logger.warning("Aylik dosya okuma hatasi atlandi: %s", dosya_yolu, exc_info=True)
        return None


def excel_dosyalarini_oku(folder_path, month=None):
    cache_key = f"{folder_path}_{month}"
    cached = _excel_cache.get(cache_key)
    if cached is not None:
        return cached

    if not os.path.exists(folder_path):
        return {}, []

    match_yil = re.search(r"(\d{4})", str(folder_path))
    yil = int(match_yil.group(1)) if match_yil else 0

    iller_dict = {}
    yillar = []

    if month and month != "Yıl Geneli":
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
            logger.warning("Il verisi hazirlanirken hata atlandi: %s", il_adi, exc_info=True)
            continue

    return pd.DataFrame(veri_listesi)


def init_db(db_path: Path) -> sqlite3.Connection:
    """Veritabanı şemasını ve indekslerini oluşturur."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
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
    logger.info("ETL işleniyor: Yıl %d (%s)", year, year_folder.name)
    records = []

    il_dirs = sorted([
        d for d in os.listdir(year_folder)
        if (year_folder / d).is_dir() and re.match(r"^\d{2}_", d)
    ])

    if not il_dirs:
        return year, [], [], []

    # Tüm illeri tarayarak mevcut ayların tam listesini çıkar (tek bir ildeki eksiklik tüm ayları bozmasın)
    found_months_set = set()
    for il_dir_name in il_dirs:
        il_path = year_folder / il_dir_name
        try:
            for f in os.listdir(il_path):
                if f.endswith(".xlsx"):
                    found_months_set.add(os.path.splitext(f)[0])
        except Exception:
            continue

    found_normalized = {normalize_header(m): m for m in found_months_set}
    mevcut_aylar = []
    for ay in AY_SIRALAMASI:
        ay_norm = normalize_header(ay)
        if ay_norm in found_normalized:
            mevcut_aylar.append(found_normalized[ay_norm])

    if not mevcut_aylar:
        mevcut_aylar = sorted(list(found_months_set))

    categories_map: dict[str, tuple[str, str]] = {}
    cleaned_categories_list = []

    for month_name in mevcut_aylar:
        for il_dir_name in il_dirs:
            il_adi = "_".join(il_dir_name.split("_")[1:]) if "_" in il_dir_name else il_dir_name
            excel_path = year_folder / il_dir_name / f"{month_name}.xlsx"
            if not excel_path.exists():
                continue

            try:
                df_raw = pd.read_excel(excel_path)
                df = extract_clean_df(df_raw)
                if df is None or df.empty:
                    continue

                for cat_raw, row in df.iterrows():
                    if not isinstance(cat_raw, str) or not cat_raw.strip():
                        continue

                    clean_lookup = temizle_metin(cat_raw)
                    if clean_lookup not in categories_map:
                        title_name = re.sub(r"^\d+\.\s*", "", cat_raw.strip()).title()
                        categories_map[clean_lookup] = (cat_raw, title_name)

                    accrual = row.get("tahakkuk")
                    collection = row.get("tahsilat")
                    excel_ratio = row.get("tahsilat/tahakkuk")

                    accrual_val = float(accrual) if pd.notna(accrual) else None
                    collection_val = float(collection) if pd.notna(collection) else None

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
                logger.warning("ETL dosya okuma hatası: %s", excel_path, exc_info=True)
                continue

    for clean_lookup, (cat_raw, title_name) in categories_map.items():
        cleaned_categories_list.append({
            "id": cat_raw,
            "name": title_name,
            "clean": clean_lookup,
        })

    return year, records, mevcut_aylar, cleaned_categories_list


def export_all_to_sqlite(target_years: list[int] | None = None, db_path: Path | None = None) -> Path:
    """Tüm Excel verilerini SQLite veritabanına aktarır."""
    if db_path is None:
        db_path = VERILER_DIR / "tahsilat_tahakkuk.db"

    logger.info("SQLite veritabanı güncelleniyor: %s", db_path)
    conn = init_db(db_path)

    if not ana_klasor or not ana_klasor.exists():
        logger.error("Ana veri klasörü bulunamadı: %s", ana_klasor)
        conn.close()
        return db_path

    # Yıl klasörlerini tekilleştirerek ve en çok .xlsx dosyası içeren aktif klasörü tespit et
    year_folders_map: dict[int, tuple[Path, int]] = {}
    for d in os.listdir(ana_klasor):
        p = ana_klasor / d
        if p.is_dir() and "raw_xls" not in d.lower() and "backup" not in d.lower():
            m = re.search(r"(\d{4})", d)
            if m:
                y_val = int(m.group(1))
                if target_years is None or y_val in target_years:
                    try:
                        has_prov_dirs = any(
                            (p / sub).is_dir() and re.match(r"^\d{2}_", sub)
                            for sub in os.listdir(p)
                        )
                    except Exception:
                        has_prov_dirs = False

                    if has_prov_dirs:
                        xlsx_cnt = sum(len([f for f in files if f.endswith(".xlsx")]) for _, _, files in os.walk(p))
                        if y_val not in year_folders_map or xlsx_cnt > year_folders_map[y_val][1]:
                            year_folders_map[y_val] = (p, xlsx_cnt)

    year_folders = sorted([(y, p) for y, (p, _) in year_folders_map.items()], key=lambda x: x[0])

    total_records = 0
    with conn:
        for year, folder in year_folders:
            y, records, aylar, categories = process_year(year, folder)
            if not records:
                logger.warning("Yıl %d için kayıt üretilemedi (klasör boş veya okunamadı: %s)", y, folder.name)
                continue

            conn.execute("DELETE FROM tax_records WHERE year = ?", (y,))
            conn.execute("DELETE FROM metadata_config WHERE year = ?", (y,))

            conn.executemany("""
            INSERT OR REPLACE INTO tax_records
            (year, month, category_id, category_clean, province, accrual, collection, ratio)
            VALUES (:year, :month, :category_id, :category_clean, :province, :accrual, :collection, :ratio)
            """, records)

            conn.execute("""
            INSERT OR REPLACE INTO metadata_config (year, months_json, categories_json)
            VALUES (?, ?, ?)
            """, (
                y,
                json.dumps(aylar, ensure_ascii=False),
                json.dumps([{"id": c["id"], "name": c["name"]} for c in categories], ensure_ascii=False)
            ))

            total_records += len(records)
            logger.info("Yıl %d kaydedildi: %d kayıt, %d ay, %d kategori.", y, len(records), len(aylar), len(categories))

    # WAL dosyasını temizle ve veritabanını sıkıştır (Railway disk kullanımını küçültür)
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        conn.execute("VACUUM;")
    except Exception:
        pass

    conn.close()
    logger.info("ETL tamamlandı! Toplam %d satır veri %s dosyasına yazıldı.", total_records, db_path)
    return db_path
