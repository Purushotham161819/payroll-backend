# Payslip fonts

Unmodified Noto Sans Regular and Bold TrueType fonts from the official Noto repository:

- https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf
- https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf

The accompanying `LICENSE.txt` is the SIL Open Font License 1.1. These fonts support the rupee symbol used by INR currency formatting. jsPDF embeds subsets in newly generated pay checks. Nest copies this directory to the production build; no runtime font download or system font installation is required.

## Current reference layout font

New pay checks select unmodified Carlito Regular and Bold from the official Google Fonts repository:

- https://github.com/google/fonts/blob/main/ofl/carlito/Carlito-Regular.ttf
- https://github.com/google/fonts/blob/main/ofl/carlito/Carlito-Bold.ttf

Carlito is used as an open-license substitute for the supplied reference's Calibri. Its license is included separately in Carlito-OFL.txt. Nest copies the fonts with the existing assets rule; jsPDF embeds subsets, including the rupee glyph. The older Noto files above are retained but are no longer selected.
