# Converts the City's pre-2018 election files, which the Node build can't read,
# into formats it can:
#   - 2006, 2010 and 2014 poll-by-poll results come as old binary .xls; each
#     becomes a .json beside it, {sheetName: rows[][]}.
#   - The 2006 voting subdivisions come as a shapefile (already WGS84); it
#     becomes data/voting-subdivisions-2006 - 4326.geojson, with AREA_LONG
#     renamed AREA_LONG_CODE to match the later years' GeoJSON.
#
# Needs xlrd and pyshp: `pip install xlrd pyshp`, then
# `python scripts/convert-old-elections.py`. Run once before
# `npm run build:elections`; the outputs only change if the City's files do.
import json
import os
import xlrd
import shapefile

DATA = os.path.join(os.path.dirname(__file__), '..', 'data')

XLS = [
    '2006-results/2006 Results/2006_Toronto_Poll_by_Poll_Mayor.xls',
    '2006-results/2006 Results/2006_Toronto_Poll_by_Poll_Councillor.xls',
    '2010-results/2010_Toronto_Poll_by_Poll_Mayor.xls',
    '2010-results/2010_Toronto_Poll_by_Poll_Councillor.xls',
    '2014-results/MAYOR.xls',
    '2014-results/COUNCILLOR.xls',
]


def cell(c):
    if c.ctype == xlrd.XL_CELL_EMPTY or c.ctype == xlrd.XL_CELL_BLANK:
        return None
    if c.ctype == xlrd.XL_CELL_NUMBER:
        return int(c.value) if c.value == int(c.value) else c.value
    return str(c.value)


for rel in XLS:
    wb = xlrd.open_workbook(os.path.join(DATA, rel))
    sheets = {sh.name: [[cell(c) for c in sh.row(r)] for r in range(sh.nrows)] for sh in wb.sheets()}
    out = os.path.join(DATA, os.path.splitext(rel)[0] + '.json')
    with open(out, 'w') as f:
        json.dump(sheets, f)
    print(out)

reader = shapefile.Reader(os.path.join(DATA, 'subdiv-2006', 'VOTING_SUBDIVISION_2006_WGS84'))
features = []
for sr in reader.shapeRecords():
    rec = sr.record.as_dict()
    features.append({
        'type': 'Feature',
        'properties': {'AREA_LONG_CODE': rec['AREA_LONG'], 'AREA_ID': rec['AREA_ID']},
        'geometry': sr.shape.__geo_interface__,
    })
out = os.path.join(DATA, 'voting-subdivisions-2006 - 4326.geojson')
with open(out, 'w') as f:
    json.dump({'type': 'FeatureCollection', 'features': features}, f)
print(out, len(features), 'subdivisions')
