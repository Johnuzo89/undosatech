"""Minimal in-memory stand-in for the supabase-py client — just enough of the
fluent query API (select/insert/order/limit/gt/eq/execute) for chain tests."""
from types import SimpleNamespace


class _Query:
    def __init__(self, rows):
        self._rows = list(rows)

    def select(self, *_):
        return self

    def order(self, col, desc=False):
        self._rows.sort(key=lambda r: r.get(col) or 0, reverse=desc)
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    def gt(self, col, v):
        self._rows = [r for r in self._rows if (r.get(col) or 0) > v]
        return self

    def eq(self, col, v):
        self._rows = [r for r in self._rows if r.get(col) == v]
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class _Table:
    def __init__(self, rows):
        self._rows = rows

    def insert(self, row):
        r = dict(row)
        r["id"] = len(self._rows) + 1
        self._rows.append(r)
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[r]))

    def __getattr__(self, name):
        return getattr(_Query(self._rows), name)


class FakeSupabase:
    def __init__(self):
        self.tables = {}

    def table(self, name):
        return _Table(self.tables.setdefault(name, []))
