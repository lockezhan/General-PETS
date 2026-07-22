# Hotfix 5 resource diagnosis

Diagnosed installed character resources:

- `pet.json`: `xiaoqian-chibi-v2`, `spriteVersionNumber: 2`, `spritesheetPath: spritesheet.webp`
- installed character ID: `codex-xiaoqian-chibi-v2`
- atlas: `1536x2288`, ARGB WebP, `192x208` cells
- adapter: schema 1, Codex source, no pre-existing `animationSequences` or `lookDirections`

```text
[pet-capabilities]
characterId=codex-xiaoqian-chibi-v2
spriteVersion=2
atlasSize=1536x2288
idleFrames=6
lookRowsPresent=true
lookFramesNonEmpty=true
```

## Idle row (row 0)

Artifacts: [contact sheet](idle-contact-sheet.png), [motion preview](idle-preview.gif).

“Left” and “right” below mean screen coordinates.

| Frame | Screen-left eye | Screen-right eye | Head | Alpha bounds | Baseline |
| --- | --- | --- | --- | --- | --- |
| 0 | open | open | centered/front | 174x198 | y=202 |
| 1 | open | open | centered/front | 174x198 | y=202 |
| 2 | closed | open | centered/front | 172x198 | y=202 |
| 3 | closed | closed | centered/front | 173x198 | y=202 |
| 4 | open | open | centered/front | 174x198 | y=202 |
| 5 | open | open | centered/front | 174x198 | y=202 |

Findings:

- A simultaneous two-eye blink exists in frame 3.
- Frame 2 is a unilateral wink immediately before the simultaneous blink. The default `0..5` playback explains the perceived sequential-eye blink.
- There is no opposite-eye unilateral frame, so this is not a left/right alternating pair.
- All six frames have the same y=202 baseline and 198 px alpha height. Width varies by only 2 px; no head jump or scale pop is visible.
- All decoded RGBA hashes are unique; there are no duplicate or misplaced frames.
- Approved character-specific idle sequence: `0,1,0,4,3,4,0,5`. It omits the unilateral wink while retaining the verified simultaneous blink.
- `idleAssetRepairRequired=false`: a valid simultaneous blink frame exists and the defect is playback order, not a missing asset.

## Look rows

Artifacts: [row 9 contact sheet](look-row-9-contact-sheet.png), [row 10 contact sheet](look-row-10-contact-sheet.png).

Every cell is non-empty, grounded at y=202, has a unique decoded RGBA hash, and changes continuously from its neighbors. Direction labels below were assigned only after contact-sheet inspection.

| Row | Column | Eyes | Head | Empty | Duplicate neighbor |
| --- | ---: | --- | --- | --- | --- |
| 9 | 0 | up | up/front | no | no |
| 9 | 1 | up-right | slight screen-right turn | no | no |
| 9 | 2 | up-right | screen-right diagonal | no | no |
| 9 | 3 | right/up | stronger screen-right turn | no | no |
| 9 | 4 | right | screen-right profile | no | no |
| 9 | 5 | right/down | screen-right profile, lowering | no | no |
| 9 | 6 | down-right | down-right turn | no | no |
| 9 | 7 | down-right | near-down, screen-right | no | no |
| 10 | 0 | down | down/front | no | no |
| 10 | 1 | down-left | near-down, screen-left | no | no |
| 10 | 2 | down-left | down-left turn | no | no |
| 10 | 3 | left/down | stronger screen-left turn | no | no |
| 10 | 4 | left | screen-left profile | no | no |
| 10 | 5 | left/up | screen-left profile, raising | no | no |
| 10 | 6 | up-left | screen-left diagonal | no | no |
| 10 | 7 | up-left | near-up, screen-left | no | no |

Verified adapter anchors:

```text
center      row 0,  column 4
up          row 9,  column 0
upperRight  row 9,  column 2
right       row 9,  column 4
lowerRight  row 9,  column 6
down        row 10, column 0
lowerLeft   row 10, column 2
left        row 10, column 4
upperLeft   row 10, column 6
```

`lookAroundAssetsPresent=true`. The verified rows form a continuous clockwise up → right → down → left → up family; version 2 alone is not used as capability evidence.
