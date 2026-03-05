---
name: google-sheets-sync
description: "Use when working on Google Sheets integration, OAuth2 flow, or the sync layer. Covers sheetsClient, sheetsMapper, sheetsSync modules and data mapping patterns."
---

# Google Sheets Sync Guide

## Architecture
Google Sheets is the single source of truth for project data. There is no application
database. All Sheets I/O runs in the browser via Google Sheets API v4.

## OAuth2 Flow
- Client-side OAuth2 token handling (Google Identity Services)
- Permissions derived from Google Drive sharing (no separate auth system)
- Token refresh handled automatically by the Google auth library

## Key Modules
- `sheetsClient.ts` — Low-level Sheets API wrapper (read/write ranges, batch operations)
- `sheetsMapper.ts` — Maps between Ganttlet task format and Sheets row format
- `sheetsSync.ts` — Orchestrates bidirectional sync (Ganttlet ↔ Sheets)

## Data Mapping
- Each task maps to a row in the spreadsheet
- Column mapping is defined in sheetsMapper
- Dates, dependencies, and constraints have specific serialization formats
- Two-way sync: changes in Ganttlet push to Sheets, changes in Sheets pull to Ganttlet

## Testing Patterns
- Unit tests mock the Sheets API responses
- Test data mapping independently from API calls
- Verify round-trip: Ganttlet → Sheets format → Ganttlet produces identical data
