import json
import sqlite3
import threading
import time


class Store:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, ts REAL, kind TEXT, data TEXT)")
        self.db.commit()

    def add(self, kind, data):
        with self.lock:
            cur = self.db.execute("INSERT INTO events(ts,kind,data) VALUES(?,?,?)",
                                  (time.time(), kind, json.dumps(data, ensure_ascii=False)))
            self.db.commit()
            return cur.lastrowid

    def recent(self, kind=None, limit=100):
        with self.lock:
            if kind:
                rows = self.db.execute("SELECT id,ts,kind,data FROM events WHERE kind=? ORDER BY id DESC LIMIT ?",
                                       (kind, limit)).fetchall()
            else:
                rows = self.db.execute("SELECT id,ts,kind,data FROM events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [{"id": r[0], "ts": r[1], "kind": r[2], **json.loads(r[3])} for r in rows]

    def counts(self):
        with self.lock:
            return dict(self.db.execute("SELECT kind,COUNT(*) FROM events GROUP BY kind").fetchall())
