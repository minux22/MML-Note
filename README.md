# MML Note

MML Note is a phone-first web app for writing ensemble scores for the Mabinogi Mobile instrument system.
A score has six tracks (melody plus five harmony tracks), and each track plays one note at a time, so that
players who join without planning can still play the piece together.

It is based on [PhraseNote](https://github.com/minux22/PhraseNote) and keeps its chord track, accompaniment
styles, roll and staff editors, keyboard input and mixer.

## What it adds

- **Six tracks**: Melody, Bass, Alto, Tenor and two extra tracks, each edited on its own, with the other tracks shown faintly.
- **Bake**: turns the chosen accompaniment (bass, keys, strings) into tracks 2–6, one voice per track.
- **MML export**: copies the score as `MML@…;` or one track at a time, with checks for the usual ensemble problems:
  the same tempo at the head of every track, equal track lengths, no shared pitch at the same time, and the
  character limit per track.
- **MML import**: pastes an existing score back into the six tracks.

## Build

```
python3 tools/build.py      # index.html (GitHub Pages) and dist/artifact.html
npm test                    # MML encoder and checker tests
```

## License

GNU General Public License v3 or later. See LICENSE.

## Sounds

By default the app downloads the bundled **GeneralUser GS v2.0.3** SoundFont by S. Christian Collins (`sf/GeneralUser-GS.sf2`, license in `sf/LICENSE.txt`) on first launch and plays each game instrument with a sound from it (Setup › Sound › Instrument sounds). The basic synth remains available.
