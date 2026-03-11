# Google Sheets Sync

## Constraints
- Sheets is the single source of truth — no application database
- Mapper field ordering must match spreadsheet column layout exactly
- Changing field order breaks existing spreadsheets
- No Google JS SDK / gapi — raw `fetch()` only

## Never
- Use Google JS SDK / gapi
- Add a separate database or persistence layer
- Change mapper field ordering without migration plan
