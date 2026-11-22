"""任务：需要一定时间的工作，在小型线程池中执行；保存所有事件，使稍后连接的监听者不会
遗漏任何信息，并提供任务应主动检查的取消标记。"""

from __future__ import annotations

import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable


class Cancelled(Exception):
    """任务察觉收到停止请求时，在内部抛出的异常。"""


class SubmissionConflict(Exception):
    """此提交标识符已经对应另一个交互轮次。"""


class QueueFull(Exception):
    """工作室的活跃交互轮次已达到容量上限。"""


class Job:
    def __init__(self) -> None:
        self.id = secrets.token_hex(6)
        self.state = "queued"
        self.events: list[dict] = []
        self.created = time.time()
        self.stop = threading.Event()
        self._lock = threading.Lock()
        self.submission: tuple[str, str] | None = None
        self.owner = ""

    def emit(self, kind: str, **data) -> None:
        with self._lock:
            self.events.append({"type": kind, **data})

    def check(self) -> None:
        """在各步骤之间调用：若有人按下停止按钮，则停止任务。"""
        if self.stop.is_set():
            raise Cancelled()

    @property
    def finished(self) -> bool:
        return self.state in ("done", "failed", "cancelled")


class Jobs:
    def __init__(self, workers: int = 2, keep: int = 200) -> None:
        self.jobs: dict[str, Job] = {}
        self.keep = keep
        self._submissions: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=max(1, workers), thread_name_prefix="likeness-job")

    def submit(self, work: Callable[[Job], None], submission: tuple[str, str] | None = None, *, owner: str = "") -> Job:
        with self._lock:
            if submission and (existing := self._submissions.get(submission[0])):
                if existing.submission != submission:
                    raise SubmissionConflict()
                return existing
            if sum(not job.finished for job in self.jobs.values()) >= 8:
                raise QueueFull()
            job = Job()
            job.submission = submission
            job.owner = owner
            self.jobs[job.id] = job
            if submission:
                self._submissions[submission[0]] = job
            self._forget_old()
            self._pool.submit(self._run, job, work)
            return job

    def cancel(self, job_id: str) -> bool:
        job = self.jobs.get(job_id)
        if job is None or job.finished:
            return False
        job.stop.set()
        return True

    def _run(self, job: Job, work: Callable[[Job], None]) -> None:
        if job.stop.is_set():
            job.state = "cancelled"
            job.emit("failed", message="开始前已取消", cancelled=True)
            return
        job.state = "running"
        try:
            work(job)
            job.state = "done"
        except Cancelled:
            job.state = "cancelled"
            job.emit("failed", message="Cancelled", cancelled=True)
        except Exception as error:   # 当前任务失败；工作室继续运行
            from .engines import EngineError

            job.state = "failed"
            if isinstance(error, EngineError):
                job.emit("failed", message=str(error), hint=error.hint)
            else:
                job.emit("failed", message="本次操作未成功", hint="请重试。")

    def _forget_old(self) -> None:
        if len(self.jobs) > self.keep:
            for old in sorted(self.jobs.values(), key=lambda j: j.created)[: len(self.jobs) - self.keep]:
                if old.finished:
                    self.jobs.pop(old.id, None)
                    if old.submission:
                        self._submissions.pop(old.submission[0], None)
