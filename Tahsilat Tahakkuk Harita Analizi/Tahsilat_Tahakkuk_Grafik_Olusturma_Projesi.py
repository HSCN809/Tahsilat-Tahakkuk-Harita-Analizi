import streamlit as st
import geopandas as gpd
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np
import os
import re
import glob
import seaborn as sns
from io import BytesIO
import uuid
import zipfile
from pathlib import Path
import json
import plotly.express as px
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_DIR = Path(__file__).resolve().parent

# 'veriler' klasörünü bul
for candidate in [BASE_DIR / "veriler", BASE_DIR.parent / "veriler", Path.cwd() / "veriler"]:
    if candidate.exists():
        VERILER_DIR = candidate
        break
else:
    st.error("'veriler' klasörü bulunamadı (repo kökünde olmalı).")
    st.stop()

# Excel ana klasörünü akıllı bul (iki olası isim + fallback: içinde yıl klasörleri olan bir klasör)
olasi_adlar = [
    "İllere Göre Tahsilat Tahakkuk (Yıllara Göre)",
    "Tahsilat Tahakkuk Excel Dosyaları",
]

ana_klasor = None
for name in olasi_adlar:
    p = VERILER_DIR / name
    if p.exists():
        ana_klasor = p
        break

# Fallback: veriler/ içinde yıl klasörleri barındıran klasörü tara
if ana_klasor is None:
    for p in VERILER_DIR.iterdir():
        if p.is_dir() and any(c.name.startswith("İllere Göre Tahsilat Tahakkuk") for c in p.iterdir() if c.is_dir()):
            ana_klasor = p
            break

if ana_klasor is None:
    st.error("Excel klasörü bulunamadı. 'veriler' içinde ilgili klasörün adını kontrol et.")
    st.stop()

harita_dosyasi = VERILER_DIR / "tr.json"
if not harita_dosyasi.exists():
    st.error("'veriler/tr.json' bulunamadı.")
    st.stop()

# Streamlit sayfa ayarları
st.set_page_config(page_title="İl Bazlı Vergi Analizi", layout="wide")

# Ana başlık
st.title("İllere Göre Tahsilat ve Tahakkuk Harita Analizi")

# Alt klasörleri listele
if os.path.exists(ana_klasor):
    alt_klasorler = sorted(
        [f for f in os.listdir(ana_klasor) if os.path.isdir(os.path.join(ana_klasor, f))],
        key=lambda x: int(re.search(r"\d{4}", x).group(0)) if re.search(r"\d{4}", x) else 0
    )
else:
    st.error("Ana klasör bulunamadı! Lütfen 'veriler' klasörünü kontrol edin.")
    st.stop()

if not alt_klasorler:
    st.error("Alt klasör bulunamadı.")
    st.stop()

# Klasör seçimi
st.sidebar.header("Ayarlar")
secilen_klasor = st.sidebar.selectbox("Klasör Seçin:", alt_klasorler)

# Seçilen klasörün tam yolu
folder_path = os.path.join(ana_klasor, secilen_klasor)

def oku_ve_temizle_tek_dosya(dosya_adi, folder_path):
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

# Excel dosyalarını okumayı önbelleğe al
@st.cache_data
def excel_dosyalarini_oku(folder_path):
    excel_dosyalari = sorted(
        [f for f in os.listdir(folder_path) if f.endswith('.xlsx')],
        key=lambda x: int(re.search(r"(\d{4})", x).group(1)) if re.search(r"(\d{4})", x) else 0
    )
    
    iller_dict = {}
    yillar = []
    
    # 16 paralel işçi ile Excel dosyalarını eşzamanlı okut
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

# Excel dosyalarını oku (Önbellekli fonksiyon çağrısı)
iller_dict, yillar = excel_dosyalarini_oku(folder_path)
st.sidebar.success(f"{len(iller_dict)} il başarıyla yüklendi")

# Yıl başlığı belirle
if len(set(yillar)) == 1:
    yil_str = str(yillar[0])
else:
    yil_str = "Yıllar"

# 📌 Harita dosyasını oku
try:
    gdf = gpd.read_file(harita_dosyasi)
    with open(harita_dosyasi, "r", encoding="utf-8") as f:
        geojson_data = json.load(f)
except Exception as e:
    st.error(f"tr.json harita dosyası bulunamadı veya okunamadı! Hata: {e}")
    st.stop()


# PNG dosyasını BytesIO'dan oluşturan fonksiyon
def fig_to_png_bytes(fig):
    """Matplotlib figürünü PNG bytes'a çeviren fonksiyon"""
    buf = BytesIO()
    fig.savefig(buf, format='png', dpi=300, bbox_inches='tight')
    buf.seek(0)
    return buf.getvalue()


# Örnek il seç ve satırları göster
if iller_dict:
    ornek_il = next(iter(iller_dict))
    ornek_df = iller_dict[ornek_il]
    satir_listesi = [str(i).strip() for i in ornek_df.index if isinstance(i, str)]

    # Satır seçimi
    secim = st.sidebar.selectbox("Analiz edilecek satırı seçin:", satir_listesi)

    # Başlığı düzgün göstermek için
    secim_baslik = re.sub(r"^\d+\.\s*", "", secim.strip()).title()

    st.sidebar.markdown("---")
    harita_tipi = st.sidebar.radio("Harita Görünümü:", ["İnteraktif (Plotly)", "Statik Görsel (Matplotlib)"])

    # Veri listesi oluştur
    veri_listesi = []

    for il_adi, df in iller_dict.items():
        try:
            temiz_indexler = {re.sub(r"^\d+\.\s*", "", i.strip(), flags=re.UNICODE).lower(): i for i in df.index if
                              isinstance(i, str)}
            secim_clean = re.sub(r"^\d+\.\s*", "", secim.strip(), flags=re.UNICODE).lower()

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

        except Exception as e:
            continue

    gelir_df = pd.DataFrame(veri_listesi)

    # İl adı düzeltmeleri
    duzeltmeler = {
        "Adıyaman": "Adiyaman", "Afyon_Karahisar": "Afyonkarahisar", "Ağrı": "Agri", "Aydın": "Aydin",
        "Balıkesir": "Balikesir", "Diyarbakır": "Diyarbakir", "Elazığ": "Elazig", "Eskişehir": "Eskisehir",
        "Gümüşhane": "Gümüshane", "Iğdır": "Iğdir", "İstanbul": "Istanbul", "İzmir": "Izmir",
        "K.Maraş": "K. Maras", "KMaraş": "K. Maras", "Kırklareli": "Kirklareli", "Kırıkkale": "Kinkkale", "Kırşehir": "Kirsehir",
        "Muğla": "Mugla", "Muş": "Mus", "Nevşehir": "Nevsehir", "Niğde": "Nigde", "Tekirdağ": "Tekirdag",
        "Urfa": "Sanliurfa", "Şanlıurfa": "Sanliurfa", "Uşak": "Usak", "Zonguldak": "Zinguldak", "Çankırı": "Çankiri", "Şırnak": "Sirnak"
    }
    gelir_df["İl"] = gelir_df["İl"].replace(duzeltmeler)

    gelir_df[["tahakkuk", "tahsilat", "tahsilat/tahakkuk"]] = gelir_df[
        ["tahakkuk", "tahsilat", "tahsilat/tahakkuk"]].round(2)

    # Harita ile birleştir
    merged = gdf.merge(gelir_df, left_on="name", right_on="İl", how="left")


    # Miktar haritası fonksiyonu
    def ciz_miktar_harita(df, kolon, baslik, cmap="YlGnBu"):
        fig, ax = plt.subplots(1, 1, figsize=(14, 12))
        plot_df = df.copy()

        # Doğrudan logaritmik ölçekleme uygulanır
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
        plt.figtext(0.74, 0.31, f"Toplam {kolon.title()}: {toplam / 1_000_000_000:.3f} Trilyon TL", fontsize=11,
                    weight='bold')
        plt.figtext(0.73, 0.29, "Kaynak: Hazine ve Maliye Bakanlığı", fontsize=11, weight='bold')
        plt.figtext(0.08, 0.278,
                    "Dipnot: Kırmızı renkli iller ya eksik veridir ya negatif veridir ya da 0'dır.",
                    fontsize=10, weight="bold", ha="left", va="bottom", color="black",
                    bbox=dict(facecolor="white", edgecolor="red", boxstyle="round,pad=0.4"))
        ax.set_title(baslik, fontsize=16, weight='bold')
        ax.axis("off")
        plt.tight_layout()

        return fig


    # Oran haritası fonksiyonu
    def ciz_oran_harita(df, kolon, baslik, cmap="coolwarm"):
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


    # İnteraktif Miktar Haritası (Plotly)
    def ciz_interaktif_miktar_harita(df, kolon, baslik, renk_olcegi="Viridis"):
        df_clean = df.copy()
        
        # Logaritmik renklendirme kolonu oluştur
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
            coloraxis_showscale=False # Log sayılarının kafa karıştırmaması için renk baremini gizle
        )
        return fig

    # İnteraktif Oran Haritası (Plotly)
    def ciz_interaktif_oran_harita(df, baslik, renk_olcegi="RdYlGn"):
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

    # Harita oluşturma butonu – sadece bir kez oluşturur
    if st.button("Haritaları Oluştur"):
        st.session_state["harita_olusturuldu"] = True

        # Statik figürleri çiz (Arka plan indirmeleri için)
        fig1 = ciz_miktar_harita(merged, "tahakkuk", f"{yil_str} İllere Göre {secim_baslik} Tahakkuku (Milyar TL)",
                                 cmap="coolwarm_r")
        fig2 = ciz_miktar_harita(merged, "tahsilat", f"{yil_str} İllere Göre {secim_baslik} Tahsilatı (Milyar TL)",
                                 cmap="coolwarm_r")
        fig3 = ciz_oran_harita(merged, "tahsilat/tahakkuk", f"{yil_str} İllere Göre {secim_baslik} Tahsilat Oranı (%)",
                               cmap="coolwarm_r")

        # PNG formatında hafızada sakla
        st.session_state["png1"] = fig_to_png_bytes(fig1)
        st.session_state["png2"] = fig_to_png_bytes(fig2)
        st.session_state["png3"] = fig_to_png_bytes(fig3)

        # Bellek sızıntısını önlemek için matplotlib figürlerini hemen kapat
        plt.close(fig1)
        plt.close(fig2)
        plt.close(fig3)

        # İnteraktif figürleri çiz ve hafızada sakla
        st.session_state["plotly_fig1"] = ciz_interaktif_miktar_harita(
            merged, "tahakkuk", f"{yil_str} İllere Göre {secim_baslik} Tahakkuku (Milyar TL)", renk_olcegi="Viridis"
        )
        st.session_state["plotly_fig2"] = ciz_interaktif_miktar_harita(
            merged, "tahsilat", f"{yil_str} İllere Göre {secim_baslik} Tahsilatı (Milyar TL)", renk_olcegi="Viridis"
        )
        st.session_state["plotly_fig3"] = ciz_interaktif_oran_harita(
            merged, f"{yil_str} İllere Göre {secim_baslik} Tahsilat Oranı (%)", renk_olcegi="RdYlGn"
        )

    # Haritalar çizildiyse ekranda göster ve indirilebilir yap
    if st.session_state.get("harita_olusturuldu", False):
        # 1. Tahakkuk Haritası
        st.subheader(f"{yil_str} İllere Göre {secim_baslik} Tahakkuku")
        if harita_tipi == "İnteraktif (Plotly)":
            st.plotly_chart(st.session_state["plotly_fig1"], use_container_width=True)
        else:
            st.image(st.session_state["png1"], width="stretch")
            
        st.download_button(
            label="📥 Tahakkuk Haritasını İndir (PNG)",
            data=st.session_state["png1"],
            file_name=f"{yil_str}_{secim_baslik}_Tahakkuk_Haritasi.png",
            mime="image/png",
            key="download_tahakkuk"
        )

        # 2. Tahsilat Haritası
        st.subheader(f"{yil_str} İllere Göre {secim_baslik} Tahsilatı")
        if harita_tipi == "İnteraktif (Plotly)":
            st.plotly_chart(st.session_state["plotly_fig2"], use_container_width=True)
        else:
            st.image(st.session_state["png2"], width="stretch")
            
        st.download_button(
            label="📥 Tahsilat Haritasını İndir (PNG)",
            data=st.session_state["png2"],
            file_name=f"{yil_str}_{secim_baslik}_Tahsilat_Haritasi.png",
            mime="image/png",
            key="download_tahsilat"
        )

        # 3. Tahsilat Oranı Haritası
        st.subheader(f"{yil_str} İllere Göre {secim_baslik} Tahsilat Oranı")
        if harita_tipi == "İnteraktif (Plotly)":
            st.plotly_chart(st.session_state["plotly_fig3"], use_container_width=True)
        else:
            st.image(st.session_state["png3"], width="stretch")
            
        st.download_button(
            label="📥 Tahsilat Oranı Haritasını İndir (PNG)",
            data=st.session_state["png3"],
            file_name=f"{yil_str}_{secim_baslik}_Tahsilat_Orani_Haritasi.png",
            mime="image/png",
            key="download_oran"
        )

        # 4. ZIP İndirme Butonu
        from io import BytesIO
        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zipf:
            zipf.writestr(f"{yil_str}_{secim_baslik}_Tahakkuk_Haritasi.png", st.session_state["png1"])
            zipf.writestr(f"{yil_str}_{secim_baslik}_Tahsilat_Haritasi.png", st.session_state["png2"])
            zipf.writestr(f"{yil_str}_{secim_baslik}_Tahsilat_Orani_Haritasi.png", st.session_state["png3"])
        zip_buffer.seek(0)

        st.download_button(
            label="📦 Tüm Haritaları İndir (ZIP)",
            data=zip_buffer,
            file_name=f"{yil_str}_{secim_baslik}_Haritalar.zip",
            mime="application/zip",
            key="download_all"
        )
