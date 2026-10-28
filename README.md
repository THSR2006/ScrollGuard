# ScrollGuard

ScrollGuard is a Chrome Manifest V3 extension that helps users understand and manage their short-form video usage. It tracks watch time across supported platforms, displays usage statistics, and can pause videos when a daily watch limit is reached.

## Features

- Tracks active video usage on:
  - YouTube
  - Instagram
  - TikTok
- Aggregates daily and monthly watch time.
- Groups usage by platform and content category.
- Configurable daily watch limit.
- Limit overlay with:
  - Custom text alerts
  - Custom uploaded images
  - Validated HTTPS image URLs
  - Light and dark themes
- Resume or ignore the limit for the rest of the day.
- Overview dashboard with platform distribution and category summaries.
- Day, week, and month statistics with watch-time trends.
- PDF usage report export.
- Local storage for usage data and settings.

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository folder.
6. Open the ScrollGuard popup from the browser toolbar.

## Supported Platforms

ScrollGuard currently supports pages hosted on:

- `youtube.com`
- `instagram.com`
- `tiktok.com`

The extension only tracks video activity on these configured hosts.

## Development

The project does not require a build step. The extension consists of the Manifest V3 configuration, popup files, background service worker, content script, and logo assets.

Run JavaScript syntax checks from the project directory:

```powershell
node --check .\background.js
node --check .\content.js
node --check .\popup.js
```

After changing the extension files, reload ScrollGuard from `chrome://extensions` before testing.

## Data and Permissions

ScrollGuard stores usage data and settings locally using Chrome storage. It requests the following permissions:

- `storage` for usage data and preferences
- `tabs` for communicating with supported pages
- `downloads` for exporting PDF reports

Host permissions are limited to the supported video platforms listed above.

## Project Structure

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 configuration |
| `background.js` | Usage aggregation, storage, and limit enforcement |
| `content.js` | Video detection, watch reporting, and limit overlay |
| `popup.html` | Popup interface structure |
| `popup.css` | Popup layout, themes, and responsive styling |
| `popup.js` | Dashboard, statistics, settings, and PDF export |
| `logo.svg`, `logo-*.png` | Extension branding assets |

## License

No license has been specified for this project yet.
