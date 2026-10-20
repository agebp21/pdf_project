"""Local search index of DOAB (Directory of Open Access Books), harvested over OAI-PMH.

DOAB's REST API refuses servers, but its OAI-PMH feed is open and its metadata is CC0.
The whole catalogue (~130k records, OAPEN's books included) is kept in a small SQLite
database with an FTS5 index, so a search is local and instant. Book chapters are left
out. OAPEN's PDFs sit behind an anti-bot check: they open in the reader's own browser,
the server never fetches them.

    python doab_index.py          # first run: everything; later runs: what changed since
    python doab_index.py --full   # start over

An interrupted harvest resumes from its last page (the resumption token is saved).
"""
import argparse
import os
from pathlib import Path
import re
import sqlite3
import time
import urllib.error
import urllib.request
from urllib.parse import urlencode
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
OAI = 'https://directory.doabooks.org/oai/request'
NS = {'oai': 'http://www.openarchives.org/OAI/2.0/', 'dc': 'http://purl.org/dc/elements/1.1/',
      'oai_dc': 'http://www.openarchives.org/OAI/2.0/oai_dc/'}
LANGS = {'eng': 'en', 'ind': 'id', 'may': 'ms', 'msa': 'ms', 'zsm': 'ms', 'ger': 'de', 'deu': 'de', 'fre': 'fr', 'fra': 'fr',
         'ita': 'it', 'spa': 'es', 'por': 'pt', 'dut': 'nl', 'nld': 'nl', 'jav': 'jv', 'ara': 'ar', 'chi': 'zh', 'zho': 'zh'}
PAUSE = 1.0                        # between pages: a polite harvester
PER_PAGE = 20


def db_path():
    return Path(os.environ.get('DOAB_DB') or ROOT / '.data' / 'doab.sqlite3')


def connect(path=None):
    path = Path(path or db_path())
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(path), timeout=30)
    db.row_factory = sqlite3.Row
    db.executescript('''
        CREATE TABLE IF NOT EXISTS books(handle TEXT PRIMARY KEY, title TEXT, authors TEXT, year TEXT, lang TEXT,
            publisher TEXT, subjects TEXT, pdf TEXT, link TEXT, doi TEXT, datestamp TEXT);
        CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(title, authors, subjects, publisher, handle UNINDEXED,
            tokenize="unicode61 remove_diacritics 2");
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);''')
    return db


def meta(db, key, value=None):
    if value is None:
        row = db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
        return row['value'] if row else ''
    db.execute('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, value))


def subject_text(value):
    """'thema EDItEUR::N History::NK Archaeology' -> 'Archaeology'; keywords as they are."""
    if '::' in value:
        return re.sub(r'^[A-Z0-9]{1,6}\s+', '', value.rsplit('::', 1)[-1]).strip()
    return value.strip()


def parse_record(record):
    """(handle, row dict or None for 'remove'), from one OAI-PMH <record>."""
    header = record.find('oai:header', NS)
    identifier = header.findtext('oai:identifier', '', NS)
    handle = identifier.rsplit(':', 1)[-1]
    if header.get('status') == 'deleted':
        return handle, None
    dc = record.find('oai:metadata/oai_dc:dc', NS)
    if dc is None:
        return handle, None
    values = lambda tag: [' '.join((e.text or '').split()) for e in dc.findall('dc:' + tag, NS) if (e.text or '').strip()]
    titles = values('title')
    if not titles or titles[0].lower().startswith('chapter '):           # chapters are not books
        return handle, None
    links = [v for v in values('identifier') if v.startswith(('http://', 'https://'))]
    pdf = next((v for v in links if v.lower().endswith('.pdf')), '')
    page = next((v for v in links if 'directory.doabooks.org/handle/' in v), f'https://directory.doabooks.org/handle/{handle}')
    read = next((v for v in links if v != page and v != pdf), '')
    years = [d[:4] for d in values('date') if re.fullmatch(r'\d{4}', d[:4] or '') and 'T' not in d]
    doi = next((v for v in values('alternateIdentifier') if v.startswith('10.')), '')
    subjects = list(dict.fromkeys(subject_text(s) for s in values('subject') if not re.fullmatch(r'[A-Z]{1,3}\d[\w.-]*', s)))
    language = (values('language') or [''])[0].lower()
    return handle, dict(title=titles[0][:500], authors='; '.join((values('creator') or values('contributor'))[:8])[:500],
                        year=(years or [''])[0], lang=LANGS.get(language, language[:3]), publisher=(values('publisher') or [''])[0][:200],
                        subjects='; '.join(subjects[:20])[:800], pdf=pdf, link=read, doi=doi,
                        datestamp=header.findtext('oai:datestamp', '', NS))


def store(db, handle, row):
    db.execute('DELETE FROM books_fts WHERE handle=?', (handle,))
    if row is None:
        db.execute('DELETE FROM books WHERE handle=?', (handle,))
        return
    db.execute('INSERT OR REPLACE INTO books(handle, title, authors, year, lang, publisher, subjects, pdf, link, doi, datestamp) '
               'VALUES(?,?,?,?,?,?,?,?,?,?,?)', (handle, row['title'], row['authors'], row['year'], row['lang'], row['publisher'],
                                                 row['subjects'], row['pdf'], row['link'], row['doi'], row['datestamp']))
    db.execute('INSERT INTO books_fts(title, authors, subjects, publisher, handle) VALUES(?,?,?,?,?)',
               (row['title'], row['authors'], row['subjects'], row['publisher'], handle))


def fetch(params, tries=4):
    url = OAI + '?' + urlencode(params)
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'MyFlipbook/1.0 (DOAB index; cs@myflipbookpro.com)'})
            with urllib.request.urlopen(request, timeout=120) as response:
                return ET.fromstring(response.read())
        except (urllib.error.URLError, TimeoutError, OSError, ET.ParseError) as cause:
            if attempt == tries - 1:
                raise RuntimeError(f'DOAB OAI-PMH tidak menjawab: {cause}') from cause
            time.sleep(10 * (attempt + 1))


def harvest(full=False, path=None, log=print, pause=PAUSE, fetcher=fetch):
    """Brings the index up to date; returns how many records were read."""
    db = connect(path)
    if full:
        db.executescript('DELETE FROM books; DELETE FROM books_fts; DELETE FROM meta;')
    token, since = meta(db, 'token'), meta(db, 'from')
    newest, seen = since, 0
    while True:
        params = {'verb': 'ListRecords', 'resumptionToken': token} if token else \
            dict({'verb': 'ListRecords', 'metadataPrefix': 'oai_dc'}, **({'from': since} if since else {}))
        root = fetcher(params)
        error = root.find('oai:error', NS)
        if error is not None:
            if error.get('code') == 'noRecordsMatch':
                break
            if error.get('code') == 'badResumptionToken' and token:            # expired: start this run again
                token = ''
                meta(db, 'token', '')
                db.commit()
                continue
            raise RuntimeError(f'DOAB: {error.get("code")} {error.text}')
        listing = root.find('oai:ListRecords', NS)
        for record in listing.findall('oai:record', NS):
            handle, row = parse_record(record)
            store(db, handle, row)
            stamp = record.findtext('oai:header/oai:datestamp', '', NS)
            newest = max(newest, stamp)
            seen += 1
        node = listing.find('oai:resumptionToken', NS)
        token = (node.text or '').strip() if node is not None else ''
        meta(db, 'token', token)
        db.commit()
        if node is not None and node.get('completeListSize'):
            log(f'{seen} / {node.get("completeListSize")} record')
        if not token:
            break
        time.sleep(pause)
    meta(db, 'from', newest)
    meta(db, 'updated', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    db.commit()
    db.close()
    return seen


def fts_query(terms):
    """Every word must appear (prefix match for the last, as people type); no FTS syntax from users."""
    words = re.findall(r'\w+', terms.lower())[:12]
    return ' '.join(f'"{w}"' + ('*' if i == len(words) - 1 and len(w) >= 3 else '') for i, w in enumerate(words))


def search(terms, page=1, lang=None, sort='relevance', per_page=PER_PAGE, path=None):
    """(rows, total) for a query; ([], 0) without an index."""
    path = Path(path or db_path())
    query = fts_query(terms)
    if not path.is_file() or not query:
        return [], 0
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        where, args = 'books_fts MATCH ?', [query]
        if lang:
            where += ' AND b.lang = ?'
            args.append(lang)
        order = {'newest': 'b.year DESC', 'oldest': "CASE WHEN b.year='' THEN 1 ELSE 0 END, b.year ASC"}.get(sort, 'bm25(books_fts, 10.0, 3.0, 2.0, 1.0)')
        base = f'FROM books_fts JOIN books b ON b.handle = books_fts.handle WHERE {where}'
        total = db.execute(f'SELECT count(*) {base}', args).fetchone()[0]
        rows = db.execute(f'SELECT b.* {base} ORDER BY {order} LIMIT ? OFFSET ?', args + [per_page, (page - 1) * per_page]).fetchall()
        return [dict(r) for r in rows], total
    except sqlite3.Error:
        return [], 0
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description='Harvest DOAB (OAI-PMH) into the local search index.')
    parser.add_argument('--full', action='store_true', help='start over instead of fetching what changed')
    args = parser.parse_args()
    started = time.time()
    count = harvest(full=args.full)
    db = connect()
    books = db.execute('SELECT count(*) FROM books').fetchone()[0]
    print(f'Selesai: {count} record dibaca, {books} buku di indeks, {round(time.time() - started)} detik.')


if __name__ == '__main__':
    main()
