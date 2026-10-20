"""Plain text (e.g. a Project Gutenberg book) to a readable PDF — Python stdlib only.

A5-like pages (book proportions for the flipbook), Helvetica / Times (WinAnsi; other
characters become '?'), a title page, paragraphs wrapped to the page width, chapter
lines set larger. Built on invoice.py's canvas and admin_report.write_pages.
"""
import re

import invoice
from admin_report import write_pages

W, H = 420, 595                      # A5 in points: book-like spreads in the flipbook
MARGIN, TOP, BOTTOM = 42, 56, 52
INK, MUTED = (0.1, 0.1, 0.1), (0.45, 0.43, 0.4)
SIZE, LEAD = 10.5, 15

GUTENBERG_START = re.compile(r'\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^*]*\*\*\*', re.I)
GUTENBERG_END = re.compile(r'\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG[^*]*\*\*\*', re.I)
CHAPTER = re.compile(r'^(chapter|book|part|volume|bab|bagian)\b[\s\w.:-]{0,40}$|^[IVXLC]+\.?$', re.I)


def strip_gutenberg(text):
    """The book only: Project Gutenberg's licence header and footer are left out."""
    start = GUTENBERG_START.search(text)
    end = GUTENBERG_END.search(text)
    return text[start.end() if start else 0:end.start() if end else len(text)].strip()


def paragraphs(text):
    """Blank-line separated paragraphs, hard line breaks inside them joined."""
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    for block in re.split(r'\n\s*\n', text):
        para = ' '.join(l.strip() for l in block.split('\n') if l.strip())
        para = re.sub(r'\[Illustration[^\]]*\]', '', para, flags=re.I)        # picture placeholders
        para = re.sub(r'(?<!\w)_|_(?!\w)', '', para).strip()                 # _italic_ markers
        if para:
            yield para


def wrap(text, size, width, bold=False):
    out, line = [], ''
    for word in text.split():
        trial = (line + ' ' + word).strip()
        if line and invoice._Canvas.width(trial, size, bold) > width:
            out.append(line)
            line = word
        else:
            line = trial
    if line:
        out.append(line)
    return out


class _Pages:
    def __init__(self, title):
        self.title, self.pages, self.number = title, [], 0
        self.new()

    def new(self):
        self.c = invoice._Canvas()
        self.pages.append(self.c)
        self.number += 1
        self.y = H - TOP
        if self.number > 1:
            self.c.text(W / 2 - invoice._Canvas.width(str(self.number - 1), 8, False) / 2, 30, str(self.number - 1), 8, False, MUTED)

    def line(self, text, size=SIZE, bold=False, lead=LEAD, center=False):
        if self.y - lead < BOTTOM:
            self.new()
        x = (W - invoice._Canvas.width(text, size, bold)) / 2 if center else MARGIN
        self.c.text(x, self.y, text, size, bold, INK)
        self.y -= lead


def build(text, title, author='', source=''):
    """PDF bytes of a book given as plain text."""
    body = strip_gutenberg(text)
    body = re.sub(r'\[Illustration[^\]]*\]', '', body, flags=re.I)      # placeholders, even across blank lines
    p = _Pages(title)
    # title page
    p.y = H * 0.62
    for part in wrap(title, 20, W - 2 * MARGIN, True):
        p.line(part, 20, True, 26, center=True)
    if author:
        p.y -= 10
        for part in wrap(author, 12, W - 2 * MARGIN):
            p.line(part, 12, False, 18, center=True)
    if source:
        p.c.text(MARGIN, BOTTOM, source, 7.5, False, MUTED)
    p.new()
    width = (W - 2 * MARGIN) * 0.94      # the width estimate runs a little short: keep clear of the edge
    for para in paragraphs(body):
        if CHAPTER.match(para) and len(para) < 60:
            if p.y < H - TOP - 40:
                p.y -= LEAD
            if p.y - 3 * LEAD < BOTTOM:
                p.new()
            p.line(para, 13, True, 22)
            continue
        for part in wrap(para, SIZE, width):
            p.line(part)
        p.y -= LEAD * 0.45
    return write_pages(['\n'.join(page.ops).encode('latin-1') for page in p.pages], title, (W, H))
