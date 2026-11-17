import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSong, encodeTrack, parseTrack, splitTicks, fitTicks, toMML, WHOLE } from '../src/mabi-mml.js';
import { lintParts, lintMML } from '../src/mabi-lint.js';

const Q = 96;
const n = (tick, dur, midi) => ({ tick, dur, midi });
const strip = (notes) => notes.map(({ tick, dur, midi }) => ({ tick, dur, midi }));

test('split chooses short tokens', () => {
  assert.deepEqual(splitTicks(Q * 5, 4, 1, 1).map((t) => t.L), [1, 4]); // c1&c
  assert.equal(splitTicks(Q * 1.5, 4)[0].dot, true); // dotted quarter
  assert.equal(splitTicks(32, 4)[0].L, 12); // triplet eighth
});

test('fitTicks snaps tiny values', () => {
  assert.equal(fitTicks(96), 96);
  assert.equal(fitTicks(3), 6);
  assert.equal(fitTicks(0), 0);
});

test('round trip: notes -> MML -> notes', () => {
  const notes = [
    n(0, Q, 60), // c4
    n(Q, Q / 2, 61), // c+8
    n(Q * 1.5, Q * 1.5, 72), // dotted, octave up
    n(Q * 4, Q * 5, 48), // tie across bar, octave down 2
    n(Q * 10, 32, 67), n(Q * 10 + 32, 32, 69), n(Q * 10 + 64, 32, 71), // triplets
    n(Q * 12, Q, 96), // far jump
  ];
  const { text } = encodeTrack(notes, { tempo: 100 });
  assert.match(text, /^t100/);
  assert.deepEqual(strip(parseTrack(text).notes), notes);
});

test('round trip without n command', () => {
  const notes = [n(0, Q, 36), n(Q, Q, 84), n(Q * 2, Q, 36)];
  const a = encodeTrack(notes, { useN: false }).text;
  const b = encodeTrack(notes, { useN: true }).text;
  assert.ok(!a.includes('n'));
  assert.ok(b.length <= a.length);
  assert.deepEqual(strip(parseTrack(a).notes), notes);
  assert.deepEqual(strip(parseTrack(b).notes), notes);
});

test('song: tempo at every track head, equal lengths, lint clean', () => {
  const song = {
    tempo: 90,
    tracks: [
      { notes: [n(0, Q * 2, 72), n(Q * 2, Q * 2, 74), n(Q * 4, Q * 3, 76)] },
      { notes: [n(0, WHOLE, 48)] },
      { notes: [n(0, Q * 4, 64), n(Q * 4, Q * 4, 67)] },
    ],
  };
  const r = encodeSong(song);
  r.parts.forEach((p) => assert.match(p, /^t90/));
  const ends = r.parts.map((p) => parseTrack(p).endTick);
  assert.deepEqual(ends, [WHOLE * 2, WHOLE * 2, WHOLE * 2]);
  const lint = lintParts(r.parts);
  assert.equal(lint.ok, true, JSON.stringify(lint.issues));
  assert.equal(lint.issues.length, 0);
  assert.match(r.mml, /^MML@t90.*;$/);
});

test('endTick option pads all tracks to the editor length', () => {
  const r = encodeSong({ tracks: [{ notes: [n(0, Q, 60)] }, { notes: [n(0, Q, 64)] }] }, { endTick: WHOLE * 4 });
  assert.deepEqual(r.parts.map((p) => parseTrack(p).endTick), [WHOLE * 4, WHOLE * 4]);
});

test('volume per note: v only where it changes, round trip', () => {
  const notes = [{ tick: 0, dur: Q, midi: 60, vol: 15 }, { tick: Q, dur: Q, midi: 62, vol: 9 }, { tick: Q * 2, dur: Q, midi: 64, vol: 12 }, { tick: Q * 3, dur: Q, midi: 65, vol: 9 }, { tick: Q * 4, dur: Q, midi: 67, vol: 9 }];
  const { text } = encodeTrack(notes, { tempo: 100 });
  assert.equal((text.match(/v/g) || []).length, 4);
  assert.deepEqual(parseTrack(text).notes.map((x) => x.vol), [15, 9, 12, 9, 9]);
});

test('encode warns about overlaps and chords inside a track', () => {
  const r = encodeSong({ tracks: [{ notes: [n(0, Q * 2, 60), n(Q, Q, 62), n(Q * 3, Q, 64), n(Q * 3, Q, 67)] }] });
  const codes = r.warnings.map((w) => w.code);
  assert.ok(codes.includes('OVERLAP_TRUNCATED'));
  assert.ok(codes.includes('CHORD_DROPPED'));
});

test('encode shifts out-of-range notes', () => {
  const r = encodeSong({ tracks: [{ notes: [n(0, Q, 10)] }] });
  assert.equal(r.warnings[0].code, 'RANGE_SHIFTED');
  assert.ok(parseTrack(r.parts[0]).notes[0].midi >= 24);
});

test('lint: missing / mismatched tempo', () => {
  const r = lintParts(['t120c4', 'c4', 't100c4']);
  const codes = r.issues.map((x) => x.code);
  assert.ok(codes.includes('TEMPO_MISSING'));
  assert.ok(codes.includes('TEMPO_MISMATCH'));
  assert.equal(r.ok, false);
});

test('lint: tempo change inside a track', () => {
  const r = lintParts(['t120c4t140c4', 't120c4c4']);
  assert.ok(r.issues.some((x) => x.code === 'TEMPO_CHANGE' && x.track === 1));
});

test('lint: length mismatch', () => {
  const r = lintParts(['t120c1c1', 't120c1']);
  assert.ok(r.issues.some((x) => x.code === 'LENGTH_MISMATCH'));
});

test('lint: same pitch in two tracks at once', () => {
  const r = lintParts(['t120c1', 't120r2c8c8c4']);
  const clash = r.issues.filter((x) => x.code === 'UNISON_CLASH');
  assert.equal(clash.length, 3);
  assert.match(clash[0].message, /bar 1 beat 3/);
  // different octave is fine
  assert.equal(lintParts(['t120c1', 't120<c1']).issues.length, 0);
});

test('lint: char limit, empty track gap, too many tracks, syntax', () => {
  const long = 't120' + 'c16'.repeat(900);
  assert.ok(lintParts([long]).issues.some((x) => x.code === 'CHAR_LIMIT'));
  assert.ok(lintParts([long], { charLimit: 5000 }).ok);
  assert.ok(lintParts(['t120c4', '', 't120e4']).issues.some((x) => x.code === 'EMPTY_BEFORE_USED' && x.track === 2));
  assert.ok(lintParts(Array(7).fill('t120c4')).issues.some((x) => x.code === 'TOO_MANY_TRACKS'));
  assert.ok(lintParts(['t120c4x']).issues.some((x) => x.code === 'SYNTAX'));
  assert.ok(lintParts(['t120o9c4']).issues.some((x) => x.code === 'SYNTAX'));
});

test('lintMML accepts full MML@...; text, ties merge', () => {
  const r = lintMML('MML@t120c2&c2,t120e1;');
  assert.equal(r.ok, true);
  assert.equal(r.stats[0].notes, 1);
  assert.equal(toMML(['a', 'b', '', '']), 'MML@a,b;');
});
