"""账户与私有空间。

每位访问者从第一次请求起就拥有一个账户：由会话 Cookie 维持的“访客”账户，以及自己的
私有空间（包含上传内容、图像和记录）。注册会直接将同一个访客账户转为会员账户，
所以无需移动内容，也不会丢失任何内容。从访客会话登录已有会员账户时，会将
访客的记录和图像移至会员空间（较新记录优先），然后停用访客账户。

  accounts  id、kind（guest | member）、handle（唯一，仅会员）、nickname、密码哈希（scrypt）、created
  sessions  sha256(token) -> 账户；令牌本身只存在于访问者的 Cookie 中
  records   (account, collection, id) -> JSON 数据、updated、deleted：应用的历史、收藏、草稿与编辑
            轨迹；同步采用最后写入者优先，所以刷新、换设备或清除浏览器数据都不会造成内容丢失

数据库位于私有文件夹中，由 Git 忽略。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import shutil
import sqlite3
import threading
import time
from pathlib import Path

HANDLE = re.compile(r"^[a-z0-9_.]{3,20}$")
COLLECTIONS = {"works", "sources", "favs", "drafts", "prefs", "threads", "styles"}
MAX_RECORD = 96 * 1024
MAX_BATCH = 200


class AccountError(ValueError):
    """用户能够自行解决的问题：此消息会原样显示给用户。"""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def _check_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    return hmac.compare_digest(_hash_password(password, bytes.fromhex(salt)).split("$")[2], digest)


def _token_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class Accounts:
    def __init__(self, home: Path) -> None:
        self.home = home
        home.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(home / "accounts.db", check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock:
            self.db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, handle TEXT UNIQUE,
                    nickname TEXT NOT NULL DEFAULT '', pw TEXT, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, account TEXT NOT NULL, created REAL NOT NULL, seen REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS records (account TEXT NOT NULL, coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
                    updated REAL NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account, coll, id));
                CREATE INDEX IF NOT EXISTS records_seq ON records (account, seq);
            """)
            self._seq = int(self.db.execute("SELECT COALESCE(MAX(seq), 0) FROM records").fetchone()[0])
        self._failures: dict[str, list[float]] = {}

    def _next(self) -> int:
        """服务器自己的游标（调用方持有锁）：同步查询该游标之后的变化，不受各设备时钟影响。"""
        self._seq += 1
        return self._seq

    # ---- 私有空间 ----
    def space(self, account_id: str) -> Path:
        """账户的私有文件夹（图像位于其中的 assets/ 下）。"""
        if not re.fullmatch(r"[0-9a-f]{24}", account_id):
            raise AccountError("未知账户。", 401)
        return self.home / "spaces" / account_id

    # ---- 会话 ----
    def guest(self) -> tuple[dict, str]:
        """新建访客账户及其会话。"""
        account_id, token, now = secrets.token_hex(12), secrets.token_urlsafe(32), time.time()
        with self.lock:
            self.db.execute("INSERT INTO accounts (id, kind, created) VALUES (?, 'guest', ?)", (account_id, now))
            self.db.execute("INSERT INTO sessions VALUES (?, ?, ?, ?)", (_token_key(token), account_id, now, now))
        return self.get(account_id), token

    def session(self, token: str) -> dict | None:
        if not token or len(token) > 128:
            return None
        key = _token_key(token)
        with self.lock:
            row = self.db.execute("SELECT account, seen FROM sessions WHERE token = ?", (key,)).fetchone()
            if row is None:
                return None
            if time.time() - row["seen"] > 3600:
                self.db.execute("UPDATE sessions SET seen = ? WHERE token = ?", (time.time(), key))
        return self.get(row["account"])

    def _attach(self, token: str, account_id: str) -> None:
        with self.lock:
            self.db.execute("UPDATE sessions SET account = ?, seen = ? WHERE token = ?", (account_id, time.time(), _token_key(token)))

    def logout(self, token: str) -> None:
        with self.lock:
            self.db.execute("DELETE FROM sessions WHERE token = ?", (_token_key(token),))

    def get(self, account_id: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT id, kind, handle, nickname, created FROM accounts WHERE id = ?", (account_id,)).fetchone()
        return dict(row) if row else None

    @staticmethod
    def public(account: dict) -> dict:
        return {"id": account["id"], "kind": account["kind"], "handle": account["handle"] or "", "nickname": account["nickname"] or "",
                "created": account["created"]}

    # ---- 注册、登录 ----
    def _throttle(self, who: str) -> None:
        now = time.time()
        recent = [t for t in self._failures.get(who, []) if now - t < 300]
        self._failures[who] = recent
        if len(recent) >= 8:
            raise AccountError("尝试次数过多。请五分钟后重试。", 429)

    def signup(self, account_id: str, handle: str, password: str, nickname: str = "") -> dict:
        """直接将访客账户转换为会员账户：账户中的所有内容均保留原位。"""
        handle = handle.strip().lower()
        if not HANDLE.fullmatch(handle):
            raise AccountError("用户名请使用3至20个小写字母、数字、下划线或句点。")
        if len(password) < 6 or len(password) > 128:
            raise AccountError("密码至少需要六个字符。")
        account = self.get(account_id)
        if account is None:
            raise AccountError("会话已过期。请刷新后重试。", 401)
        if account["kind"] != "guest":
            raise AccountError("你已经登录。", 409)
        with self.lock:
            try:
                self.db.execute("UPDATE accounts SET kind = 'member', handle = ?, nickname = ?, pw = ? WHERE id = ?",
                                (handle, (nickname.strip() or handle)[:24], _hash_password(password), account_id))
            except sqlite3.IntegrityError:
                raise AccountError("该用户名已被使用。请选择其他用户名。", 409) from None
        return self.get(account_id)

    def login(self, token: str, current: dict, handle: str, password: str, who: str = "") -> tuple[dict, int]:
        """让此会话登录会员账户。访客的记录与图像会一并转入。"""
        self._throttle(who or "-")
        with self.lock:
            row = self.db.execute("SELECT id, pw FROM accounts WHERE handle = ? AND kind = 'member'", (handle.strip().lower(),)).fetchone()
        if row is None or not _check_password(password, row["pw"] or ""):
            self._failures.setdefault(who or "-", []).append(time.time())
            raise AccountError("用户名或密码不正确。请检查后重试。", 401)
        moved = 0
        if current["id"] != row["id"] and current["kind"] == "guest":
            moved = self.merge(current["id"], row["id"])
        self._attach(token, row["id"])
        return self.get(row["id"]), moved

    def rename(self, account_id: str, nickname: str) -> dict:
        with self.lock:
            self.db.execute("UPDATE accounts SET nickname = ? WHERE id = ?", (nickname.strip()[:24], account_id))
        return self.get(account_id)

    def merge(self, source: str, target: str) -> int:
        """将访客记录（以较新记录为准）和私有图像移至另一个账户，然后停用该访客账户。"""
        with self.lock:
            rows = self.db.execute("SELECT coll, id, data, updated, deleted FROM records WHERE account = ?", (source,)).fetchall()
            moved = 0
            for r in rows:
                have = self.db.execute("SELECT updated FROM records WHERE account = ? AND coll = ? AND id = ?", (target, r["coll"], r["id"])).fetchone()
                if have is None or have["updated"] < r["updated"]:
                    self.db.execute("INSERT OR REPLACE INTO records VALUES (?, ?, ?, ?, ?, ?, ?)", (target, r["coll"], r["id"], r["data"], r["updated"], r["deleted"], self._next()))
                    moved += 1
            self.db.execute("DELETE FROM records WHERE account = ?", (source,))
            self.db.execute("UPDATE sessions SET account = ? WHERE account = ?", (target, source))
            self.db.execute("DELETE FROM accounts WHERE id = ? AND kind = 'guest'", (source,))
        src, dst = self.space(source) / "assets", self.space(target) / "assets"
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
            for f in src.iterdir():
                if not (dst / f.name).exists():
                    shutil.move(str(f), dst / f.name)
            shutil.rmtree(self.space(source), ignore_errors=True)
        return moved

    # ---- 记录 ----
    def since(self, account_id: str, cursor: int = 0, limit: int = 1000) -> tuple[list[dict], int]:
        """返回游标之后发生变化的记录，以及供下次查询使用的游标。"""
        with self.lock:
            rows = self.db.execute("SELECT coll, id, data, updated, deleted, seq FROM records WHERE account = ? AND seq > ? ORDER BY seq LIMIT ?",
                                   (account_id, cursor, limit)).fetchall()
        out = [{"coll": r["coll"], "id": r["id"], "data": json.loads(r["data"]), "updated": r["updated"], "deleted": bool(r["deleted"])} for r in rows]
        return out, (rows[-1]["seq"] if rows else cursor)

    def put(self, account_id: str, records: list[dict]) -> int:
        if len(records) > MAX_BATCH:
            raise AccountError("一次同步请求中的记录过多。", 413)
        applied = 0
        with self.lock:
            for rec in records:
                coll, rid = str(rec.get("coll", "")), str(rec.get("id", ""))
                if coll not in COLLECTIONS or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,80}", rid):
                    continue
                data = json.dumps(rec.get("data") or {}, ensure_ascii=False, separators=(",", ":"))
                if len(data.encode("utf-8")) > MAX_RECORD:
                    continue
                updated = float(rec.get("updated") or time.time() * 1000)
                have = self.db.execute("SELECT updated FROM records WHERE account = ? AND coll = ? AND id = ?", (account_id, coll, rid)).fetchone()
                if have is not None and have["updated"] >= updated:
                    continue
                self.db.execute("INSERT OR REPLACE INTO records VALUES (?, ?, ?, ?, ?, ?, ?)", (account_id, coll, rid, data, updated, int(bool(rec.get("deleted"))), self._next()))
                applied += 1
        return applied

    def counts(self, account_id: str) -> dict:
        with self.lock:
            rows = self.db.execute("SELECT coll, COUNT(*) AS n FROM records WHERE account = ? AND deleted = 0 GROUP BY coll", (account_id,)).fetchall()
        return {r["coll"]: r["n"] for r in rows}
