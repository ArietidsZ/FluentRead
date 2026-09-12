# Bundled interface fonts

Used only by FluentRead's Options and Popup pages. No font CDN, remote font
request, or installation on the user's device is required. Other scripts fall
back to system fonts. The original variable weights (100–900) and glyph sets
are retained; only the container is converted from TTF to WOFF2.

Both fonts are distributed under SIL Open Font License 1.1. The full copyright
and license notices are included alongside the assets:

- Inter: `Inter-OFL.txt`, https://github.com/rsms/inter
- Noto Sans SC: `NotoSansSC-OFL.txt`, https://github.com/notofonts/noto-cjk

## Reproduction

Source: https://github.com/google/fonts/tree/809e4d8b8d7e9364a914909bb777679606c178b8

- `ofl/inter/Inter[opsz,wght].ttf`
- `ofl/notosanssc/NotoSansSC[wght].ttf`
- The `OFL.txt` from each respective directory.

Convert with FontTools 4.38.0 and Brotli 1.1.0 in a temporary Python environment:

```sh
python -m fontTools.ttLib.woff2 compress Inter.ttf -o Inter.woff2
python -m fontTools.ttLib.woff2 compress NotoSansSC.ttf -o NotoSansSC.woff2
```

SHA-256:

| File | SHA-256 |
| --- | --- |
| Source Inter.ttf | 29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031 |
| Source NotoSansSC.ttf | a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da |
| Inter.woff2 | 13b4cddc57045d40b411008e61588c8f81aa0bd72fe884624831a0ff9c4d159a |
| NotoSansSC.woff2 | aef8c34277afad81ecd0227138a830263c0caea65b7aea66d1195395f097b55a |
