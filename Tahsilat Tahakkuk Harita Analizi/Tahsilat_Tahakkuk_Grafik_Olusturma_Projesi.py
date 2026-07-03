import os
import re
import json
import pandas as pd
import numpy as np
import geopandas as gpd
import matplotlib.pyplot as plt
import plotly.express as px
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
    # Kütüphane olarak çağrıldığında hata fırlatması için exception kullanalım
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

harita_dosyasi = VERILER_DIR / "tr.json"
if not harita_dosyasi.exists():
    raise FileNotFoundError("❌ 'veriler/tr.json' harita dosyası bulunamadı.")

# GeoJSON harita dosyasını belleğe yükle
with open(harita_dosyasi, "r", encoding="utf-8") as f:
    geojson_data = json.load(f)

# GeoPandas ile harita sınırlarını yükle
gdf = gpd.read_file(harita_dosyasi)

def oku_ve_temizle_tek_dosya(dosya_adi, folder_path):
    """
    Tek bir Excel dosyasını okuyup temizler.
    """
    match = re.match(r"(.+?)_(\d{4})\.xlsx", dosya_adi)
    if not match:
        return None
        
    il_kodlu, yil = match.groups()
    il_adi = "_".join(il_kodlu.split("_")[1:]) if "_" in il_kodlu else il_kodlu
    dosya_yolu = os.path.join(folder_path, dosya_adi)
    try:
        df = pd.read_excel(dosya_yolu, skiprows=2)
        df = df.drop(index=0)
        df = df.drop(columns=['Unnamed: 0'], errors='ignore')
        df.columns = ['index', 'tahakkuk', 'tahsilat', 'tahsilat/tahakkuk']
        df.set_index('index', inplace=True)
        
        for col in ['tahakkuk', 'tahsilat', 'tahsilat/tahakkuk']:
            df[col] = pd.to_numeric(df[col], errors="coerce").round(2)
            
        return il_adi, int(yil), df
    except Exception:
        return None

def excel_dosyalarini_oku(folder_path):
    """
    Klasördeki tüm il Excel dosyalarını paralel olarak okur.
    """
    excel_dosyalari = sorted(
        [f for f in os.listdir(folder_path) if f.endswith('.xlsx')],
        key=lambda x: int(re.search(r"(\d{4})", x).group(1)) if re.search(r"(\d{4})", x) else 0
    )
    
    iller_dict = {}
    yillar = []
    
    with ThreadPoolExecutor(max_workers=16) as executor:
        futures = [
            executor.submit(oku_ve_temizle_tek_dosya, dosya_adi, folder_path)
            for dosya_adi in excel_dosyalari
        ]
        
        for future in as_completed(futures):
            res = future.result()
            if res:
                il_adi, yil, df = res
                iller_dict[il_adi] = df
                yillar.append(yil)
                
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

    gelir_df[["tahakkuk", "tahsilat", "tahsilat/tahakkuk"]] = gelir_df[["tahakkuk", "tahsilat", "tahsilat/tahakkuk"]].round(2)

    # Harita sınırları ile verileri birleştir
    merged = gdf.merge(gelir_df, left_on="name", right_on="İl", how="left")
    return merged

def ciz_miktar_harita(df, kolon, baslik, cmap="YlGnBu"):
    """
    Statik Miktar Haritası çizer (Matplotlib) - Logaritmik Ölçekli.
    """
    fig, ax = plt.subplots(1, 1, figsize=(14, 12))
    plot_df = df.copy()

    pozitif_mask = plot_df[kolon] > 0
    plot_df[kolon] = plot_df[kolon].astype(float)
    plot_df.loc[pozitif_mask, kolon] = np.log1p(plot_df.loc[pozitif_mask, kolon])
    plot_df.loc[~pozitif_mask, kolon] = np.nan

    plot_df.plot(
        column=kolon,
        cmap=cmap,
        linewidth=0.5,
        edgecolor="gray",
        legend=False,
        ax=ax,
        missing_kwds={"color": "red", "label": "Veri Yok"}
    )

    for idx, row in df.iterrows():
        val = row[kolon]
        x, y = row.geometry.centroid.x, row.geometry.centroid.y
        il_kisa = row["name"][:3].upper()
        ax.annotate(il_kisa, (x, y + 0.07), ha="center", va="bottom", fontsize=7, color="black", weight="bold")

        if pd.notnull(val):
            etiket = f"{val / 1_000_000:.2f}M"
            ax.annotate(etiket, (row.geometry.centroid.x, row.geometry.centroid.y),
                        ha="center", va="center", fontsize=7.5, color="black", weight="bold")

    for idx, row in df[df[kolon].isna()].iterrows():
        x, y = row.geometry.centroid.x, row.geometry.centroid.y
        ax.text(x, y, "✖", fontsize=10, color="black", ha="center", va="center")

    toplam = df[kolon].sum(skipna=True)
    plt.figtext(0.74, 0.31, f"Toplam {kolon.title()}: {toplam / 1_000_000_000:.3f} Trilyon TL", fontsize=11, weight='bold')
    plt.figtext(0.73, 0.29, "Kaynak: Hazine ve Maliye Bakanlığı", fontsize=11, weight='bold')
    plt.figtext(0.08, 0.278,
                "Dipnot: Kırmızı renkli iller ya eksik veridir ya negatif veridir ya da 0'dır.",
                fontsize=10, weight="bold", ha="left", va="bottom", color="black",
                bbox=dict(facecolor="white", edgecolor="red", boxstyle="round,pad=0.4"))

    ax.set_title(baslik, fontsize=16, weight='bold')
    ax.axis("off")
    plt.tight_layout()

    return fig

def ciz_oran_harita(df, kolon, baslik, cmap="coolwarm"):
    """
    Statik Oran Haritası çizer (Matplotlib).
    """
    fig, ax = plt.subplots(1, 1, figsize=(14, 12))
    plot_df = df.copy()

    plot_df["oran"] = np.where((plot_df["tahakkuk"] > 0) & (plot_df["tahsilat"] > 0),
                               plot_df["tahsilat"] / plot_df["tahakkuk"] * 100, np.nan)

    plot_df.plot(
        column="oran",
        cmap=cmap,
        linewidth=0.5,
        edgecolor="gray",
        legend=False,
        ax=ax,
        missing_kwds={"color": "red", "label": "Veri Yok"}
    )

    for idx, row in df.iterrows():
        try:
            tahakkuk = row["tahakkuk"]
            tahsilat = row["tahsilat"]

            il_kisa = row["name"][:3].upper()
            x, y = row.geometry.centroid.x, row.geometry.centroid.y
            ax.annotate(il_kisa, (x, y + 0.07), ha="center", va="bottom", fontsize=7, color="black", weight="bold")

            if pd.notnull(tahakkuk) and pd.notnull(tahsilat) and tahakkuk > 0 and tahsilat > 0:
                oran = tahsilat / tahakkuk * 100
                etiket = f"{oran:.2f}%"
                ax.annotate(etiket, (row.geometry.centroid.x, row.geometry.centroid.y),
                            ha="center", va="center", fontsize=7.5, color="black", weight="bold")
            else:
                ax.text(row.geometry.centroid.x, row.geometry.centroid.y,
                        "✖", fontsize=10, color="black", ha="center", va="center")
        except:
            continue

    tahakkuk = df["tahakkuk"].sum(skipna=True)
    tahsilat = df["tahsilat"].sum(skipna=True)
    oran = (tahsilat / tahakkuk) * 100 if tahakkuk else 0
    plt.figtext(0.745, 0.31, f"TR Geneli Tahsilat Oranı: {oran:.2f}%", fontsize=11, weight='bold')
    plt.figtext(0.73, 0.29, "Kaynak: Hazine ve Maliye Bakanlığı", fontsize=11, weight='bold')
    plt.figtext(0.08, 0.278,
                "Dipnot: Kırmızı renkli iller ya eksik veridir ya negatif veridir ya da 0'dır.",
                fontsize=10, weight="bold", ha="left", va="bottom", color="black",
                bbox=dict(facecolor="white", edgecolor="red", boxstyle="round,pad=0.4"))

    ax.set_title(baslik, fontsize=16, weight='bold')
    ax.axis("off")
    plt.tight_layout()

    return fig

def ciz_interaktif_miktar_harita(df, kolon, baslik, renk_olcegi="Viridis"):
    """
    İnteraktif Miktar Haritası çizer (Plotly) - Logaritmik Ölçekli.
    """
    df_clean = df.copy()
    log_col = f"{kolon}_log"
    df_clean[log_col] = np.where(df_clean[kolon] > 0, np.log1p(df_clean[kolon]), np.nan)
    
    df_clean["Değer (Milyar TL)"] = df_clean[kolon].round(4)
    df_clean["İl Adı"] = df_clean["name"].str.capitalize()
    
    fig = px.choropleth(
        df_clean,
        geojson=geojson_data,
        locations="name",
        featureidkey="properties.name",
        color=log_col,
        color_continuous_scale=renk_olcegi,
        hover_name="İl Adı",
        hover_data={"name": False, log_col: False, "Değer (Milyar TL)": True},
    )
    fig.update_geos(fitbounds="locations", visible=False)
    fig.update_layout(
        title={"text": baslik, "y":0.95, "x":0.5, "xanchor": 'center', "yanchor": 'top'},
        margin={"r":0,"t":50,"l":0,"b":0},
        height=600,
        coloraxis_showscale=False
    )
    return fig

def ciz_interaktif_oran_harita(df, baslik, renk_olcegi="RdYlGn"):
    """
    İnteraktif Oran Haritası çizer (Plotly).
    """
    df_clean = df.copy()
    df_clean["oran"] = np.where((df_clean["tahakkuk"] > 0) & (df_clean["tahsilat"] > 0),
                                df_clean["tahsilat"] / df_clean["tahakkuk"] * 100, np.nan)
    df_clean["Oran (%)"] = df_clean["oran"].round(2)
    df_clean["İl Adı"] = df_clean["name"].str.capitalize()
    
    fig = px.choropleth(
        df_clean,
        geojson=geojson_data,
        locations="name",
        featureidkey="properties.name",
        color="oran",
        color_continuous_scale=renk_olcegi,
        hover_name="İl Adı",
        hover_data={"name": False, "oran": False, "Oran (%)": True},
    )
    fig.update_geos(fitbounds="locations", visible=False)
    fig.update_layout(
        title={"text": baslik, "y":0.95, "x":0.5, "xanchor": 'center', "yanchor": 'top'},
        margin={"r":0,"t":50,"l":0,"b":0},
        height=600
    )
    return fig
