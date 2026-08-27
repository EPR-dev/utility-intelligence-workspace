# Data sources

All metrics in the workstation should be traceable. If a source cannot be retrieved, the UI
marks it **Data source not yet connected** instead of inventing values.

## Connected in V1

### Endeavour Energy Open Data (Peclet / Opendatasoft)

- Portal: https://data.endeavourenergy.com.au/
- Licence: Open Database License (ODbL) for most network asset datasets; some capacity/district layers have no declared licence on the portal.
- Used: `distribution-district`, `networkassets_otherassets` (zone, transmission, HV switching, distribution substations), `distribution-substation-available-capacity` (`avlbl_k`).
- Not loaded: poles (~440k) and conductors (~809k). They are too large for this workstation and are not required for strategic discovery.
- Important: `avlbl_k` is treated as remaining **load** capacity at distribution substations. It is **not** generation hosting capacity or export headroom.

### Clean Energy Regulator — small-scale installation postcode data

- https://cer.gov.au/markets/reports-and-data/small-scale-installation-postcode-data
- Direct CSV documents, e.g. `/document/sgu-solar-installations-2011-to-present-and-totals`
- Monthly STC-registered installations aggregated to calendar years.
- Limitations: includes upgrades and off-grid; latest years incomplete because of the 12-month creation window; batteries from 1 July 2025 only.

### ABS ASGS 2021 Postal Areas (POA)

- CC BY 4.0, © Commonwealth of Australia
- Used as choropleth geometry. POA is not identical to Australia Post delivery catchments in every case.

### OpenStreetMap (Overpass)

- ODbL, © OpenStreetMap contributors
- Industrial/commercial land use and EV charging in a Southern Highlands / Illawarra bbox.
- Volunteer geography, not zoning.

## Not yet connected

| Source | Why it matters |
| --- | --- |
| ABS Census dwellings / population by POA | True solar penetration and demographic growth |
| NSW planning / DA extracts | Connection-assessment pressure |
| Endeavour generation hosting / flexible-export limits | The missing validation layer for Flexible Export scores |
| Public feeder polygons | Below-zone topology |

Basemap (Chrome/Edge MapLibre): CARTO Dark Matter **vector** style (`basemaps.cartocdn.com/gl/dark-matter-gl-style`) with OSM attribution. Raster PNG tiles from the same CDN now require a free API key or they watermark; the vector style is the browser default. Optional `NEXT_PUBLIC_CARTO_API_KEY` in `frontend/.env.local`.
