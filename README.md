# Tag Review Tool

A lightweight browser-based tool for QA editors to review and select the best categories, topics, and tags from two versions of AI-generated article labels.

## How it works

1. Upload a `.xlsx` or `.csv` file
2. For each article, click to select the best tags from the combined pool of both versions
3. Leave an optional comment per article
4. Download results when done

## Input format

The spreadsheet must contain these columns:

| Column | Description |
|---|---|
| `post_id` | Article identifier |
| `title` | Article title |
| `summary` | Article summary |
| `categories1` / `categories2` | Categories from version 1 and 2 |
| `topics1` / `topics2` | Topics from version 1 and 2 |
| `tags1` / `tags2` | Tags from version 1 and 2 |

Values in each category/topic/tag column are pipe-delimited (e.g. `Politics|Economy|Budget`).

## Output

| File | Contents |
|---|---|
| `labeled_table.csv` | Original data + `categories_chosen`, `topics_chosen`, `tags_chosen`, `comment` columns |
| `version_report.csv` | Per-article breakdown + overall V1 vs V2 preference score and verdict |

## Usage

No installation or build step required. Open `index.html` directly in a browser.

To deploy on GitHub Pages: push to a repository and enable **Settings → Pages → Branch: main**.

## Tech

Static HTML/CSS/JS. Uses [SheetJS](https://sheetjs.com/) (CDN) to parse Excel files in the browser. No data is sent to any server.
