"""ALPINE: SAJ public decimal point lists -> independent static dataset.
Based on snowtech-team-manager's public calendar/ZIP acquisition approach.
No connection to its Worker, accounts, team records, or storage.
"""
import csv
import hashlib
import io
import json
import re
import sys
import time
import urllib.request
import zipfile
from datetime import datetime, timezone, timedelta
from html import unescape
from pathlib import Path

ORIGIN = 'https://sajdb.shikuminet.jp'
JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent

def download(url):
    if not url.startswith(ORIGIN + '/'):
        raise ValueError('Unexpected source host')
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'ALPINE-SAJ/1.0 (public point list)', 'Accept': '*/*'})
            with urllib.request.urlopen(req, timeout=60) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

def text(cell):
    return unescape(re.sub('<[^>]+>', '', cell)).strip()

def calendar_entries(html):
    entries = []
    for tr in re.findall(r'<tr\b[\s\S]*?</tr>', html, re.I):
        cells = re.findall(r'<td\b[^>]*>([\s\S]*?)</td>', tr, re.I)
        if len(cells) < 9 or not text(cells[0]).isdigit():
            continue
        # Column 8 is the official decimal list, not the integer list.
        links = re.findall(r'href=["\']([^"\']+\.zip)["\']', cells[7], re.I)
        files = {}
        for link in links:
            sex = '男子' if 'AM_' in link else '女子' if 'AW_' in link else None
            if sex:
                files[sex] = ORIGIN + unescape(link) if link.startswith('/') else unescape(link)
        if len(files) == 2:
            entries.append({'number': int(text(cells[0])), 'files': files,
                            'validFrom': text(cells[2]), 'validTo': text(cells[3]),
                            'published': text(cells[6])})
    return sorted(entries, key=lambda e: e['number'], reverse=True)

def category(birth, season):
    if not re.fullmatch(r'\d{6}', birth):
        return '未確認'
    yy, mm, dd = int(birth[:2]), int(birth[2:4]), int(birth[4:])
    year = (2000 if yy <= season % 100 else 1900) + yy
    try:
        datetime(year, mm, dd)
    except ValueError:
        return '未確認'
    ordinal = year * 10000 + mm * 100 + dd
    return 'K2' if (season-16)*10000+101 <= ordinal <= (season-13)*10000+401 else '一般'

def parse_zip(raw, sex, category_season):
    rows = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for file in archive.infolist():
            if not file.filename.lower().endswith(('.txt', '.csv')):
                continue
            if file.file_size > 20_000_000:
                raise ValueError('Point file unexpectedly large')
            data = archive.read(file)
            try:
                decoded = data.decode('utf-8-sig')
            except UnicodeDecodeError:
                decoded = data.decode('cp932')
            reader = csv.DictReader(io.StringIO(decoded))
            headers = reader.fieldnames or []
            required = ['SAJNO', '氏名漢', '県連盟', '所属', '生年月日']
            point_columns = {}
            for discipline in ['SL', 'GS', 'SG']:
                matches = [h for h in headers if h.startswith('SAJ_' + discipline)]
                if len(matches) != 1:
                    raise ValueError('Missing unambiguous SAJ column: ' + discipline)
                point_columns[discipline] = matches[0]
            if any(h not in headers for h in required):
                raise ValueError('SAJ identity headers changed')
            for r in reader:
                saj = r['SAJNO'].strip()
                if not re.fullmatch(r'\d{8}', saj) or not r['氏名漢'].strip():
                    raise ValueError('Invalid SAJ identity row')
                points = {}
                for discipline, column in point_columns.items():
                    value = r[column].strip()
                    if value in ('', '-', '―', '—'):
                        points[discipline] = None
                    elif re.fullmatch(r'\d+(?:\.\d+)?', value):
                        points[discipline] = float(value)
                    else:
                        raise ValueError('Invalid SAJ point: ' + value)
                # Birth date and all FIS columns are deliberately omitted from output.
                rows.append({'id': saj, 'name': r['氏名漢'].strip(), 'team': r['所属'].strip(),
                             'pref': r['県連盟'].strip(), 'sex': sex,
                             'category': category(r['生年月日'].strip(), category_season), 'points': points})
    if len(rows) < 50 or len({r['id'] for r in rows}) != len(rows):
        raise ValueError('Incomplete or duplicate point list')
    if not any(r['points']['SL'] is not None for r in rows):
        raise ValueError('No valid SL points')
    return rows

def main():
    now = datetime.now(JST)
    current = now.year + (now.month >= 7)
    found = None
    for season in [current, current-1]:
        url = f'{ORIGIN}/alpine/point/calendar?season_code={season}'
        entries = calendar_entries(download(url).decode('utf-8'))
        if entries:
            found = (season, url, entries[0])
            break
    if not found:
        raise ValueError('No published SAJ decimal lists; previous dataset retained')
    season, url, entry = found
    rows, sources = [], []
    for sex, source in entry['files'].items():
        raw = download(source)
        got = parse_zip(raw, sex, current)
        rows.extend(got)
        sources.append({'sex': sex, 'url': source, 'count': len(got), 'sha256': hashlib.sha256(raw).hexdigest()})
    if len({r['id'] for r in rows}) != len(rows):
        raise ValueError('Duplicate SAJ numbers between lists')
    target = ROOT / 'saj-data.json'
    if target.exists():
        old = json.loads(target.read_text(encoding='utf-8'))
        if (season, entry['number']) < (old['season'], old['listNumber']):
            raise ValueError('Refusing older list')
        if len(rows) < len(old['athletes']) * .6 and season == old['season']:
            raise ValueError('Unexpected loss of athletes; previous dataset retained')
    result = {'schema': 1, 'provider': 'SAJ', 'season': season, 'categorySeason': current,
              'listNumber': entry['number'], 'checkedAt': now.isoformat(), 'calendarUrl': url,
              'validFrom': entry['validFrom'], 'validTo': entry['validTo'], 'published': entry['published'],
              'sources': sources, 'athletes': sorted(rows, key=lambda r: r['id'])}
    pending = target.with_suffix('.json.tmp')
    pending.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    pending.replace(target)
    print(f'SAJ {season} No.{entry["number"]}: {len(rows)} athletes; SL/GS/SG only')

if __name__ == '__main__':
    main()
