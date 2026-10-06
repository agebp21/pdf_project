"""Approximate place of a visitor (country, province, city, internet provider)
from the IP address, for the admin statistics — looked up on this server in
the free DB-IP Lite databases (CC BY 4.0, https://db-ip.com), so the IP never
leaves the server and is not stored: only the place names are kept.

The databases live in .data/geo (or GEOIP_DIR); without them every lookup is
None and nothing else changes. Download / refresh them (monthly):

    python3 geo.py --update

A small reader for the MaxMind DB format (.mmdb), standard library only.
"""
import gzip
import ipaddress
import mmap
import os
from pathlib import Path
import shutil
import struct
import sys
import threading
import time
import urllib.request

FILES = {'city': 'dbip-city-lite.mmdb', 'asn': 'dbip-asn-lite.mmdb'}
URL = 'https://download.db-ip.com/free/{name}-{month}.mmdb.gz'
META = b'\xab\xcd\xefMaxMind.com'


class Reader:
    def __init__(self, path):
        self.file = open(path, 'rb')
        self.buf = mmap.mmap(self.file.fileno(), 0, access=mmap.ACCESS_READ)
        start = self.buf.rfind(META)
        if start < 0:
            raise ValueError('not a MaxMind DB file')
        self.meta, _ = self.decode(start + len(META), start + len(META))
        self.nodes = self.meta['node_count']
        self.record = self.meta['record_size']
        if self.record not in (24, 28, 32):
            raise ValueError('unsupported record size')
        self.tree = self.record * 2 // 8 * self.nodes
        self.data = self.tree + 16
        self.v4 = 0
        if self.meta['ip_version'] == 6:                 # IPv4 addresses sit under ::/96
            for _ in range(96):
                if self.v4 >= self.nodes:
                    break
                self.v4 = self.child(self.v4, 0)

    def close(self):
        self.buf.close(); self.file.close()

    def child(self, node, bit):
        b = self.buf
        if self.record == 24:
            o = node * 6 + bit * 3
            return int.from_bytes(b[o:o + 3], 'big')
        if self.record == 28:
            o = node * 7
            if bit:
                return ((b[o + 3] & 0x0F) << 24) | int.from_bytes(b[o + 4:o + 7], 'big')
            return ((b[o + 3] & 0xF0) << 20) | int.from_bytes(b[o:o + 3], 'big')
        o = node * 8 + bit * 4
        return int.from_bytes(b[o:o + 4], 'big')

    def get(self, ip):
        address = ipaddress.ip_address(ip)
        if address.version == 6 and address.ipv4_mapped:
            address = address.ipv4_mapped
        if address.version == 6 and self.meta['ip_version'] == 4:
            return None
        bits = address.max_prefixlen
        node = self.v4 if address.version == 4 else 0
        value = int(address)
        for i in range(bits - 1, -1, -1):
            if node >= self.nodes:
                break
            node = self.child(node, (value >> i) & 1)
        if node <= self.nodes:                           # == nodes: not in the database
            return None
        return self.decode(self.data + node - self.nodes - 16, self.data)[0]

    def decode(self, at, base):
        """(value, next offset) of the data field at `at`; pointers are relative to `base`."""
        b = self.buf
        ctrl = b[at]; at += 1
        kind = ctrl >> 5
        if kind == 1:                                    # pointer
            size = (ctrl >> 3) & 3
            v = ctrl & 7
            if size == 0:
                p = (v << 8) | b[at]
            elif size == 1:
                p = ((v << 16) | int.from_bytes(b[at:at + 2], 'big')) + 2048
            elif size == 2:
                p = ((v << 24) | int.from_bytes(b[at:at + 3], 'big')) + 526336
            else:
                p = int.from_bytes(b[at:at + 4], 'big')
            return self.decode(base + p, base)[0], at + size + 1
        if kind == 0:                                    # extended type
            kind = 7 + b[at]; at += 1
        size = ctrl & 0x1F
        if size >= 29:
            n = size - 28
            size = (29, 285, 65821)[n - 1] + int.from_bytes(b[at:at + n], 'big')
            at += n
        if kind == 2:
            return b[at:at + size].decode('utf-8', 'replace'), at + size
        if kind == 7:
            out = {}
            for _ in range(size):
                key, at = self.decode(at, base)
                out[key], at = self.decode(at, base)
            return out, at
        if kind == 11:
            out = []
            for _ in range(size):
                item, at = self.decode(at, base)
                out.append(item)
            return out, at
        if kind in (5, 6, 9, 10):
            return int.from_bytes(b[at:at + size], 'big'), at + size
        if kind == 8:
            return int.from_bytes(b[at:at + size], 'big', signed=size == 4), at + size
        if kind == 3:
            return struct.unpack('>d', b[at:at + 8])[0], at + 8
        if kind == 15:
            return struct.unpack('>f', b[at:at + 4])[0], at + 4
        if kind == 14:
            return bool(size), at
        if kind == 4:
            return bytes(b[at:at + size]), at + size
        raise ValueError(f'unknown data type {kind}')


def folder():
    return Path(os.environ.get('GEOIP_DIR') or Path(os.environ.get('MYFLIPBOOK_DB') or Path(__file__).resolve().parent / '.data' / 'x').parent / 'geo')


READERS = {}
LOCK = threading.Lock()


def reader(kind):
    path = folder() / FILES[kind]
    with LOCK:
        cached = READERS.get(kind)
        try:
            stamp = path.stat().st_mtime
        except OSError:
            return None
        if cached and cached[0] == (str(path), stamp):
            return cached[1]
        try:
            fresh = Reader(path)
        except (OSError, ValueError):
            return None
        READERS[kind] = ((str(path), stamp), fresh)   # an old reader is left for the collector (it may still be in use)
        return fresh


def name(entry):
    names = (entry or {}).get('names') or {}
    return names.get('en') or next(iter(names.values()), '')


def lookup(ip):
    """{'country', 'country_code', 'region', 'city', 'isp'} or None (private
    address, unknown, or no database)."""
    try:
        address = ipaddress.ip_address((ip or '').strip())
    except ValueError:
        return None
    if not address.is_global:
        return None
    place = {}
    try:
        city = reader('city')
        found = city.get(str(address)) if city else None
        if found:
            subdivisions = found.get('subdivisions') or [{}]
            place.update(country=name(found.get('country')), country_code=(found.get('country') or {}).get('iso_code', ''),
                         region=name(subdivisions[0]), city=name(found.get('city')))
        asn = reader('asn')
        found = asn.get(str(address)) if asn else None
        if found:
            place['isp'] = found.get('autonomous_system_organization', '')
    except Exception:
        return None
    return {k: str(v)[:100] for k, v in place.items() if v} or None


def update(target=None, month=None):
    """Download this month's DB-IP Lite files (last month's while the new one is
    not out yet) into the geo folder."""
    target = Path(target or folder())
    target.mkdir(parents=True, exist_ok=True)
    now = time.gmtime()
    months = [month] if month else [time.strftime('%Y-%m', now),
                                    '%04d-%02d' % ((now.tm_year, now.tm_mon - 1) if now.tm_mon > 1 else (now.tm_year - 1, 12))]
    for kind, filename in FILES.items():
        for m in months:
            url = URL.format(name=filename[:-5], month=m)
            tmp = target / (filename + '.part')
            try:
                request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (MyFlipbook geo update)'})
                with urllib.request.urlopen(request, timeout=120) as r, gzip.GzipFile(fileobj=r) as z, open(tmp, 'wb') as out:
                    shutil.copyfileobj(z, out)
                Reader(tmp).close()                      # a broken download never replaces a good file
            except Exception as e:
                tmp.unlink(missing_ok=True)
                print(f'{kind} {m}: {e}')
                continue
            os.replace(tmp, target / filename)
            print(f'{kind}: {filename} ({m})')
            break


if __name__ == '__main__':
    if sys.argv[1:2] == ['--update']:
        update(sys.argv[2] if len(sys.argv) > 2 else None)
    elif sys.argv[1:]:
        for ip in sys.argv[1:]:
            print(ip, lookup(ip))
    else:
        print(__doc__)
