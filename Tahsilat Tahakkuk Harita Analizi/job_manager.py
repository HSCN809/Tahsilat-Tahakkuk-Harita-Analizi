"""
Teke-aktif-iş kuralı ve iş durumu.

- `request_lock`: aynı anda en fazla bir scrape job çalışsın.
- `current_job`: o anda yürüyen veya son tamamlanan işin metadata'sı.
- `submit(...)`: yeni bir iş başlatır; eğer zaten çalışıyorsa False döner.
"""
from __future__ import annotations

import threading
import time
import traceback
from dataclasses import dataclass, asdict, field
from typing import Callable, Any, Optional


@dataclass
class JobInfo:
    job_id: str
    year_input: str
    started_at: float
    finished_at: Optional[float] = None
    status: str = "running"  # running | succeeded | failed
    error: Optional[str] = None
    backup_created: Optional[str] = None


class JobManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._current: Optional[JobInfo] = None
        self._job_counter = 0

    def _next_id(self) -> str:
        self._job_counter += 1
        return f"job-{int(time.time())}-{self._job_counter}"

    def is_running(self) -> bool:
        with self._state_lock:
            return self._current is not None and self._current.status == "running"

    def current(self) -> Optional[dict]:
        with self._state_lock:
            if self._current is None:
                return None
            return asdict(self._current)

    def submit(self, year_input: str, runner: Callable[[JobInfo], None],
               backup_notifier: Optional[Callable[[], Optional[str]]] = None) -> tuple[bool, dict]:
        """
        runner(job_info): asıl işi yapan sync fonksiyon.
        backup_notifier(): opsiyonel. İş başarılı tamamlandığında tetiklenir;
            snapshot yedek alır ve dosya yolunu döner.
        Returns: (started: bool, info: dict).
        """
        if not self._lock.acquire(blocking=False):
            return False, self.current() or {"status": "busy"}

        job_id = self._next_id()
        info = JobInfo(job_id=job_id, year_input=year_input, started_at=time.time())
        with self._state_lock:
            self._current = info

        def _wrapped() -> None:
            try:
                runner(info)
                info.status = "succeeded"
            except Exception as exc:
                info.status = "failed"
                info.error = f"{type(exc).__name__}: {exc}"
            finally:
                info.finished_at = time.time()
                if info.status == "succeeded" and backup_notifier is not None:
                    try:
                        info.backup_created = backup_notifier()
                    except Exception:
                        traceback.print_exc()
                self._lock.release()

        thread = threading.Thread(target=_wrapped, name=job_id, daemon=True)
        thread.start()
        return True, asdict(info)


job_manager = JobManager()
