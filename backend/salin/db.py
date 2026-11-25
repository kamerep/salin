"""SQLite storage: glossary, history (with FTS5 search) and settings."""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 2

_SCHEMA = """
CREATE TABLE IF NOT EXISTS glossary (
    id          INTEGER PRIMARY KEY,
    term        TEXT NOT NULL COLLATE NOCASE UNIQUE,
    meaning     TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('person','entity','abbreviation','term')),
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
    id           INTEGER PRIMARY KEY,
    created_at   TEXT NOT NULL,
    mode         TEXT NOT NULL CHECK (mode IN ('translate','compose')),
    direction    TEXT NOT NULL,
    model        TEXT NOT NULL,
    provider     TEXT NOT NULL,
    source_text  TEXT NOT NULL,
    output_text  TEXT NOT NULL,
    result_json  TEXT NOT NULL,
    starred      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS history_created ON history(created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
    source_text, output_text, content='history', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS history_ai AFTER INSERT ON history BEGIN
    INSERT INTO history_fts(rowid, source_text, output_text)
    VALUES (new.id, new.source_text, new.output_text);
END;
CREATE TRIGGER IF NOT EXISTS history_ad AFTER DELETE ON history BEGIN
    INSERT INTO history_fts(history_fts, rowid, source_text, output_text)
    VALUES ('delete', old.id, old.source_text, old.output_text);
END;

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS languages (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    native_name TEXT NOT NULL DEFAULT '',
    enabled     INTEGER NOT NULL DEFAULT 1,
    quality     TEXT NOT NULL DEFAULT 'strong' CHECK (quality IN ('strong','weak')),
    notes       TEXT NOT NULL DEFAULT '',
    registers   TEXT NOT NULL,
    speech_code TEXT NOT NULL DEFAULT '',
    tts_code    TEXT NOT NULL DEFAULT '',
    sort        INTEGER NOT NULL DEFAULT 100,
    updated_at  TEXT NOT NULL
);
"""

# Columns added after version 1; applied with ALTER TABLE when missing.
_COLUMNS = {
    "glossary": {"spellings": "TEXT NOT NULL DEFAULT '{}'"},
    "history": {"source_lang": "TEXT NOT NULL DEFAULT ''", "target_lang": "TEXT NOT NULL DEFAULT ''"},
}

DEFAULT_SETTINGS: dict[str, Any] = {
    "default_model": "haiku",
    "effort_haiku": "low",
    "effort_sonnet": "medium",
    "save_history": True,
    "retention_days": 0,
    "offline_fallback": True,
    "default_target": "en",      # translate into this language by default
    "second_language": "tl",     # used when the message is already in the target
    "reply_language": "tl",      # default language for drafted replies
    "speech_input": True,
    "speech_model": "small",
}


def now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(_SCHEMA)
        self._migrate()
        self._conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
        self._seed_languages()
        try:
            path.chmod(0o600)
        except OSError:
            pass

    def _migrate(self) -> None:
        for table, cols in _COLUMNS.items():
            have = {r["name"] for r in self._conn.execute(f"PRAGMA table_info({table})")}
            for name, decl in cols.items():
                if name not in have:
                    self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
        self._conn.execute("CREATE INDEX IF NOT EXISTS history_pair ON history(source_lang, target_lang)")

    def _seed_languages(self) -> None:
        from .languages import DEFAULT_LANGUAGES

        if self._conn.execute("SELECT COUNT(*) FROM languages").fetchone()[0]:
            return
        for lang in DEFAULT_LANGUAGES:
            self._insert_language(self._conn, {"enabled": True, **lang})

    @staticmethod
    def _insert_language(c: sqlite3.Connection, lang: dict[str, Any]) -> None:
        c.execute(
            "INSERT INTO languages(code, name, native_name, enabled, quality, notes, registers, "
            "speech_code, tts_code, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (lang["code"], lang["name"], lang.get("native_name", ""), int(lang.get("enabled", True)),
             lang.get("quality", "strong"), lang.get("notes", ""),
             json.dumps(lang["registers"], ensure_ascii=False), lang.get("speech_code", ""),
             lang.get("tts_code", ""), lang.get("sort", 100), now_iso()),
        )

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield self._conn
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
            self._conn.execute("COMMIT")

    def query(self, sql: str, params: tuple | dict = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, params).fetchall()

    def close(self) -> None:
        self._conn.close()

    # ---- settings -------------------------------------------------------
    def get_settings(self) -> dict[str, Any]:
        values = dict(DEFAULT_SETTINGS)
        for row in self.query("SELECT key, value FROM settings"):
            if row["key"] in values:
                values[row["key"]] = json.loads(row["value"])
        return values

    def update_settings(self, changes: dict[str, Any]) -> dict[str, Any]:
        with self.tx() as c:
            for key, value in changes.items():
                if key in DEFAULT_SETTINGS:
                    c.execute(
                        "INSERT INTO settings(key, value) VALUES (?, ?) "
                        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        (key, json.dumps(value)),
                    )
        return self.get_settings()

    # ---- languages ------------------------------------------------------
    @staticmethod
    def _lang_row(row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        d["enabled"] = bool(d["enabled"])
        d["registers"] = json.loads(d["registers"])
        return d

    def list_languages(self, enabled_only: bool = False) -> list[dict[str, Any]]:
        sql = "SELECT * FROM languages" + (" WHERE enabled = 1" if enabled_only else "")
        return [self._lang_row(r) for r in self.query(sql + " ORDER BY sort, name")]

    def get_language(self, code: str) -> dict[str, Any] | None:
        rows = self.query("SELECT * FROM languages WHERE code = ?", (code,))
        return self._lang_row(rows[0]) if rows else None

    def create_language(self, lang: dict[str, Any]) -> dict[str, Any]:
        with self.tx() as c:
            self._insert_language(c, lang)
        return self.get_language(lang["code"])  # type: ignore[return-value]

    def update_language(self, code: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {k: v for k, v in fields.items() if k in {
            "name", "native_name", "enabled", "quality", "notes", "registers",
            "speech_code", "tts_code", "sort"}}
        if "registers" in allowed:
            allowed["registers"] = json.dumps(allowed["registers"], ensure_ascii=False)
        if "enabled" in allowed:
            allowed["enabled"] = int(allowed["enabled"])
        if allowed:
            sets = ", ".join(f"{k} = :{k}" for k in allowed)
            with self.tx() as c:
                c.execute(f"UPDATE languages SET {sets}, updated_at = :ts WHERE code = :code",
                          {**allowed, "ts": now_iso(), "code": code})
        return self.get_language(code)

    def delete_language(self, code: str) -> bool:
        with self.tx() as c:
            return c.execute("DELETE FROM languages WHERE code = ?", (code,)).rowcount > 0

    def reset_languages(self) -> None:
        with self.tx() as c:
            c.execute("DELETE FROM languages")
        with self._lock:
            self._seed_languages()

    # ---- glossary -------------------------------------------------------
    @staticmethod
    def _gloss_row(row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        d["spellings"] = json.loads(d.get("spellings") or "{}")
        return d

    def list_glossary(self) -> list[dict[str, Any]]:
        rows = self.query("SELECT * FROM glossary ORDER BY kind, term COLLATE NOCASE")
        return [self._gloss_row(r) for r in rows]

    def get_glossary(self, entry_id: int) -> dict[str, Any] | None:
        rows = self.query("SELECT * FROM glossary WHERE id = ?", (entry_id,))
        return self._gloss_row(rows[0]) if rows else None

    def create_glossary(self, term: str, meaning: str, kind: str, notes: str,
                        spellings: dict[str, str] | None = None) -> dict[str, Any]:
        ts = now_iso()
        with self.tx() as c:
            cur = c.execute(
                "INSERT INTO glossary(term, meaning, kind, notes, spellings, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (term, meaning, kind, notes, json.dumps(spellings or {}, ensure_ascii=False), ts, ts),
            )
            new_id = cur.lastrowid
        return self.get_glossary(new_id)  # type: ignore[return-value]

    def update_glossary(self, entry_id: int, fields: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {k: v for k, v in fields.items() if k in {"term", "meaning", "kind", "notes", "spellings"}}
        if "spellings" in allowed:
            allowed["spellings"] = json.dumps(allowed["spellings"], ensure_ascii=False)
        if allowed:
            sets = ", ".join(f"{k} = :{k}" for k in allowed)
            with self.tx() as c:
                c.execute(
                    f"UPDATE glossary SET {sets}, updated_at = :ts WHERE id = :id",
                    {**allowed, "ts": now_iso(), "id": entry_id},
                )
        return self.get_glossary(entry_id)

    def delete_glossary(self, entry_id: int) -> bool:
        with self.tx() as c:
            return c.execute("DELETE FROM glossary WHERE id = ?", (entry_id,)).rowcount > 0

    def upsert_glossary_many(self, entries: list[dict[str, str]]) -> tuple[int, int]:
        created = updated = 0
        ts = now_iso()
        with self.tx() as c:
            for e in entries:
                row = c.execute("SELECT id FROM glossary WHERE term = ?", (e["term"],)).fetchone()
                if row:
                    c.execute(
                        "UPDATE glossary SET meaning=?, kind=?, notes=?, spellings=?, updated_at=? WHERE id=?",
                        (e["meaning"], e["kind"], e.get("notes", ""),
                         json.dumps(e.get("spellings") or {}, ensure_ascii=False), ts, row["id"]),
                    )
                    updated += 1
                else:
                    c.execute(
                        "INSERT INTO glossary(term, meaning, kind, notes, spellings, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (e["term"], e["meaning"], e["kind"], e.get("notes", ""),
                         json.dumps(e.get("spellings") or {}, ensure_ascii=False), ts, ts),
                    )
                    created += 1
        return created, updated

    # ---- history --------------------------------------------------------
    def add_history(
        self,
        *,
        mode: str,
        direction: str,
        model: str,
        provider: str,
        source_text: str,
        output_text: str,
        result: dict[str, Any],
        source_lang: str = "",
        target_lang: str = "",
    ) -> int:
        with self.tx() as c:
            cur = c.execute(
                "INSERT INTO history(created_at, mode, direction, model, provider, source_text, "
                "output_text, result_json, source_lang, target_lang) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (now_iso(), mode, direction, model, provider, source_text, output_text,
                 json.dumps(result, ensure_ascii=False), source_lang, target_lang),
            )
            return int(cur.lastrowid)

    @staticmethod
    def _history_row(row: sqlite3.Row, full: bool) -> dict[str, Any]:
        item = {
            "id": row["id"],
            "created_at": row["created_at"],
            "mode": row["mode"],
            "direction": row["direction"],
            "model": row["model"],
            "provider": row["provider"],
            "source_text": row["source_text"],
            "output_text": row["output_text"],
            "starred": bool(row["starred"]),
            "source_lang": row["source_lang"],
            "target_lang": row["target_lang"],
        }
        if full:
            item["result"] = json.loads(row["result_json"])
        return item

    @staticmethod
    def _fts_query(text: str) -> str:
        # Quote every token so user input can never be parsed as FTS syntax.
        tokens = [t.replace('"', '""') for t in text.split() if t.strip()]
        return " ".join(f'"{t}"*' for t in tokens)

    def search_history(
        self, *, q: str = "", mode: str | None = None, starred: bool = False,
        limit: int = 50, offset: int = 0, pair: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        where, params = [], []
        base = "FROM history h"
        if q.strip():
            base += " JOIN history_fts f ON f.rowid = h.id"
            where.append("history_fts MATCH ?")
            params.append(self._fts_query(q))
        if mode:
            where.append("h.mode = ?")
            params.append(mode)
        if starred:
            where.append("h.starred = 1")
        if pair:
            src, tgt = pair.split(">", 1)
            where += ["h.source_lang = ?", "h.target_lang = ?"]
            params += [src, tgt]
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        total = self.query(f"SELECT COUNT(*) AS n {base}{clause}", tuple(params))[0]["n"]
        rows = self.query(
            f"SELECT h.* {base}{clause} ORDER BY h.created_at DESC, h.id DESC LIMIT ? OFFSET ?",
            (*params, limit, offset),
        )
        return [self._history_row(r, full=False) for r in rows], int(total)

    def history_pairs(self) -> list[dict[str, Any]]:
        rows = self.query(
            "SELECT source_lang, target_lang, COUNT(*) AS n FROM history "
            "WHERE source_lang != '' AND target_lang != '' "
            "GROUP BY source_lang, target_lang ORDER BY n DESC"
        )
        return [dict(r) for r in rows]

    def get_history(self, item_id: int) -> dict[str, Any] | None:
        rows = self.query("SELECT * FROM history WHERE id = ?", (item_id,))
        return self._history_row(rows[0], full=True) if rows else None

    def star_history(self, item_id: int, starred: bool) -> bool:
        with self.tx() as c:
            return c.execute(
                "UPDATE history SET starred = ? WHERE id = ?", (int(starred), item_id)
            ).rowcount > 0

    def delete_history(self, item_id: int) -> bool:
        with self.tx() as c:
            return c.execute("DELETE FROM history WHERE id = ?", (item_id,)).rowcount > 0

    def clear_history(self, keep_starred: bool) -> int:
        with self.tx() as c:
            sql = "DELETE FROM history" + (" WHERE starred = 0" if keep_starred else "")
            return c.execute(sql).rowcount

    def purge_history(self, retention_days: int) -> int:
        if retention_days <= 0:
            return 0
        cutoff = (datetime.now(UTC) - timedelta(days=retention_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self.tx() as c:
            return c.execute(
                "DELETE FROM history WHERE created_at < ? AND starred = 0", (cutoff,)
            ).rowcount
