import os
import sys
import time
import tarfile
import importlib
import tempfile
from pathlib import Path

import pytest

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

import job_manager
import backup
import Tahsilat_Tahakkuk_Grafik_Olusturma_Projesi as lib


# --- job_manager: tek-aktif-iş kuralı ---
def test_job_manager_single_active_job():
    mgr = job_manager.JobManager()

    def slow_runner(job):
        time.sleep(0.2)

    ok1, _ = mgr.submit("2024", runner=slow_runner)
    assert ok1 is True
    assert mgr.is_running() is True

    ok2, _ = mgr.submit("2025", runner=slow_runner)
    assert ok2 is False  # çakışma reddedildi

    # iş bitene dek bekle
    deadline = time.time() + 2
    while mgr.is_running() and time.time() < deadline:
        time.sleep(0.05)
    assert mgr.is_running() is False
    cur = mgr.current()
    assert cur["status"] == "succeeded"


def test_job_manager_failure_recorded():
    mgr = job_manager.JobManager()

    def boom(job):
        raise ValueError("patladı")

    ok, _ = mgr.submit("2024", runner=boom)
    assert ok is True
    deadline = time.time() + 2
    while mgr.is_running() and time.time() < deadline:
        time.sleep(0.05)
    cur = mgr.current()
    assert cur["status"] == "failed"
    assert "patladı" in cur["error"]


# --- backup: snapshot üzerine yazma ---
def test_backup_take_snapshot_overwrites():
    with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as bkp:
        (Path(src) / "a.txt").write_text("v1")
        first = backup.take_snapshot(src, bkp)
        assert Path(first).exists()
        # içerik doğrula
        with tarfile.open(first) as tf:
            names = tf.getnames()
        assert any("a.txt" in n for n in names)

        # ikinci snapshot: içerik değişti, üzerine yazıldı
        (Path(src) / "a.txt").write_text("v2")
        (Path(src) / "b.txt").write_text("yeni")
        second = backup.take_snapshot(src, bkp)
        assert second == first  # aynı dosya (üzerine yazıldı)
        with tarfile.open(second) as tf:
            names2 = tf.getnames()
        assert any("b.txt" in n for n in names2)


# --- input validation ---
def test_validate_year():
    import api as api_mod
    api_mod._validate_year(2025)  # hata vermez
    with pytest.raises(Exception):
        api_mod._validate_year(1900)


def test_validate_year_input():
    import api as api_mod
    for good in ["2024", "2024-2025", "2024-2025,2023", "hepsi"]:
        api_mod._validate_year_input(good)  # hata vermez
    for bad in ["", "abc", "2024x", "20"]:
        with pytest.raises(Exception):
            api_mod._validate_year_input(bad)


# --- API rotaları (token gerektirmeyenler) ---
def test_root_and_status_routes():
    os.environ.setdefault("SCRAPE_TOKEN", "test-token")
    import importlib as _il
    _il.reload(__import__("api"))
    import api as api_mod
    from fastapi.testclient import TestClient
    client = TestClient(api_mod.app)
    r = client.get("/")
    assert r.status_code == 200
    assert "endpoints" in r.json()
    r2 = client.get("/api/jobs/status")
    assert r2.status_code == 200
    assert "running" in r2.json()


def test_scrape_requires_token():
    os.environ["SCRAPE_TOKEN"] = "secret-token"
    import importlib as _il
    _il.reload(__import__("api"))
    import api as api_mod
    from fastapi.testclient import TestClient
    client = TestClient(api_mod.app)
    # token yok -> 401
    r = client.post("/api/scrape?year_input=2024")
    assert r.status_code == 401
    # token var ama gerçek scraper'ı tetiklememek için job lock'ı bypass:
    # burada sadece auth katmanını doğruluyoruz; scraper çağrısı uzun sürer.


# --- ham veri indirme: /api/files ve /api/files/download ---
import io as _io
import zipfile as _zipfile

_TEST_YEAR = 2099


def _make_raw_year(tmp_path, monkeypatch):
    """Sahte yıl klasörü + raw_xls içeriği oluşturur, lib yolunu buna yönlendirir."""
    year_dir = tmp_path / f"İllere Göre Tahsilat Tahakkuk {_TEST_YEAR}"
    raw_dir = year_dir / "raw_xls"
    raw_dir.mkdir(parents=True)
    (raw_dir / "01-Adana-2099.xls").write_bytes(b"sahte-xls-1")
    (raw_dir / "06-Ankara-2099.xls").write_bytes(b"sahte-xls-2")
    (raw_dir / "not-excel.txt").write_text("excel değil")  # listeye girmemeli
    monkeypatch.setattr(
        lib, "get_year_folder_path",
        lambda y: str(tmp_path / f"İllere Göre Tahsilat Tahakkuk {y}"),
    )


def _client():
    import importlib as _il
    _il.reload(__import__("api"))
    import api as api_mod
    from fastapi.testclient import TestClient
    return TestClient(api_mod.app)


def test_files_listing(tmp_path, monkeypatch):
    _make_raw_year(tmp_path, monkeypatch)
    client = _client()
    r = client.get(f"/api/files?year={_TEST_YEAR}")
    assert r.status_code == 200
    body = r.json()
    assert body["year"] == _TEST_YEAR
    names = [f["name"] for f in body["files"]]
    assert names == ["01-Adana-2099.xls", "06-Ankara-2099.xls"]
    ids = [f["id"] for f in body["files"]]
    assert ids == ["01-Adana-2099", "06-Ankara-2099"]
    assert all(f["size"] > 0 for f in body["files"])


def test_files_listing_year_not_found(tmp_path, monkeypatch):
    _make_raw_year(tmp_path, monkeypatch)
    client = _client()
    r = client.get("/api/files?year=2098")  # klasörü olmayan yıl
    assert r.status_code == 404


def test_files_download_selected_zip(tmp_path, monkeypatch):
    _make_raw_year(tmp_path, monkeypatch)
    client = _client()
    r = client.get(f"/api/files/download?year={_TEST_YEAR}&files=01-Adana-2099")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert "attachment" in r.headers["content-disposition"]
    with _zipfile.ZipFile(_io.BytesIO(r.content)) as zf:
        assert zf.namelist() == ["01-Adana-2099.xls"]
        assert zf.read("01-Adana-2099.xls") == b"sahte-xls-1"


def test_files_download_all(tmp_path, monkeypatch):
    _make_raw_year(tmp_path, monkeypatch)
    client = _client()
    r = client.get(f"/api/files/download?year={_TEST_YEAR}&all=true")
    assert r.status_code == 200
    with _zipfile.ZipFile(_io.BytesIO(r.content)) as zf:
        assert sorted(zf.namelist()) == ["01-Adana-2099.xls", "06-Ankara-2099.xls"]


def test_files_download_invalid_id(tmp_path, monkeypatch):
    _make_raw_year(tmp_path, monkeypatch)
    client = _client()
    r = client.get(f"/api/files/download?year={_TEST_YEAR}&files=99-Olmayan-2099")
    assert r.status_code == 400


def test_files_download_empty_selection(tmp_path, monkeypatch):
    _make_raw_year(tmp_path, monkeypatch)
    client = _client()
    r = client.get(f"/api/files/download?year={_TEST_YEAR}")
    assert r.status_code == 400


def test_files_download_path_traversal_rejected(tmp_path, monkeypatch):
    _make_raw_year(tmp_path, monkeypatch)
    client = _client()
    r = client.get(f"/api/files/download?year={_TEST_YEAR}&files=../../secret")
    assert r.status_code == 400
