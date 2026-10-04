---
title: Offline download & installation
description: Install FluentRead through CRXSOso or the official ZIP package when the Chrome Web Store is unavailable.
---

# Offline download & installation

If the Chrome Web Store does not open, try **[CRXSOso](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj)**, or download the official ZIP package and install it manually in desktop Chrome / Edge.

## Get FluentRead through CRXSOso

Open [FluentRead on CRXSOso](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj) and follow the website’s installation or download instructions.

CRXSOso is a third-party distribution website. Its version may differ from the official store, so check the version shown before downloading.

## Download the official offline package

| File | Download |
| --- | --- |
| Chrome / Edge extension ZIP · v0.0.34 | [Download the offline package](https://github.com/FluentRead/FluentRead/releases/download/v0.0.34/fluent-read-0.0.34-chrome.zip) |
| SHA-256 checksums | [Download SHA256SUMS.txt](https://github.com/FluentRead/FluentRead/releases/download/v0.0.34/SHA256SUMS.txt) |

These files come from the official GitHub Release v0.0.34, published on September 13, 2026. See the [official release page](https://github.com/FluentRead/FluentRead/releases/latest) for other versions. Choose the extension package ending in **`-chrome.zip`**. The `-sources.zip` file and GitHub’s automatic Source code downloads contain source code and cannot be installed directly.

GitHub downloads still depend on your network. Try CRXSOso above if the download is unavailable. Offline installation means you can install the downloaded package without accessing the Chrome Web Store; online translation still needs a connection to your chosen provider.

## Install in Chrome / Edge

1. Extract the ZIP into a folder you intend to keep.
2. Enter **`chrome://extensions`** in the address bar, or **`edge://extensions`** in Edge.
3. Enable **Developer mode**, then choose **Load unpacked**.
4. Select the extracted folder that directly contains **`manifest.json`**. Do not select the ZIP file or its parent folder.
5. Pin FluentRead to the toolbar and refresh any normal webpages that were already open.

Copy browser internal addresses into the address bar; normal websites cannot link directly to them. Keep the extracted folder in place after installation.

## Update an offline installation

An unpacked extension does not receive store updates automatically. Before updating, export your configuration from **Backup & sync** in FluentRead’s settings.

Download the new Chrome ZIP and extract it over the original installation folder, then select FluentRead’s **Reload** button on the extensions page. Refresh webpages you want to translate. Reuse the same folder to avoid duplicate installations and keep a backup of the previous folder before replacing files.

Continue with [Installation & first translation](/en/guide/getting-started).
