"""
One-shot scraper giriş noktası.

`docker run --rm ... scraper_image 2024-2025` şeklinde çağrılır.
Hiç argüman verilmezse SCRAPE_YEARS ortam değişkenine bakar,
o da yoksa "hepsi" ile çalışır.

İş bittiğinde container `--rm` ile otomatik silinir (kalıcı servis yok).
"""
import sys
import os
import glob
import importlib.util


def _load_scraper_module():
    """Unicode dosya adını güvenle içe aktarır."""
    candidates = glob.glob(os.path.join(os.path.dirname(__file__), "Hazine_Maliye_Bakanlığı_Sitesinden_Excel_Dosyalarını_Çekme.py"))
    if not candidates:
        raise FileNotFoundError("Scraper kaynak dosyası bulunamadı.")
    path = candidates[0]
    spec = importlib.util.spec_from_file_location("hmb_scraper", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    args = sys.argv[1:]
    if not args:
        env_years = os.environ.get("SCRAPE_YEARS", "").strip()
        if env_years:
            args = [env_years]
        else:
            args = ["hepsi"]

    scraper = _load_scraper_module()
    original_argv = sys.argv
    sys.argv = ["scraper_one_shot.py", *args]
    try:
        scraper.main()
    finally:
        sys.argv = original_argv
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
