import type { AnswerKey } from '@/engine/types';

/** SERVER-ONLY marking data for the practice bank. Never import from UI code. */

const single = (questionId: string, correct: string, display: string, explanation: string): AnswerKey => ({
  questionId, version: 1, marks: 1, rule: { kind: 'single', correct }, display, explanation,
});
const text = (questionId: string, accepted: string[], display: string, explanation: string): AnswerKey => ({
  questionId, version: 1, marks: 1, rule: { kind: 'text', accepted, maxWords: 1, ignorePunctuation: true }, display, explanation,
});

export const practiceBankKeys: AnswerKey[] = [
  single('pb-q01', 'FALSE', 'False', 'The logbooks record "far more than the weather" — ships, lamp repairs and birds — so "only weather" contradicts the passage.'),
  single('pb-q02', 'NOT_GIVEN', 'Not Given', 'Ornithologists are mentioned only as the people who now use the digitised entries. Nothing says the keepers themselves were trained in bird science.'),
  text('pb-q03', ['foggy'], 'foggy', 'Birds struck the glass "on foggy nights".'),
  single('pb-q04', 'B', 'B — The baking is finished just before dawn.', 'The passage says working "before dawn" means loaves reach shops still warm. The warmth is linked to timing, not to shop ovens or special flour.'),
  text('pb-q05', ['cool'], 'cool', 'The dough has finished "a slow rise in cool rooms".'),
  single('pb-q06', 'TRUE', 'True', 'Ovens run "at their most efficient when electricity demand is low" — a paraphrase of taking advantage of lower demand.'),
  single('pb-q07', 'B', 'Paragraph B', 'Paragraph B reports residents who "worry that items will come back damaged".'),
  single('pb-q08', 'A', 'Paragraph A', 'Paragraph A: members may borrow an item "for up to a week".'),
  text('pb-q09', ['volunteers'], 'volunteers', 'Each tool is "inspected and repaired by volunteers after every loan".'),
  single('pb-q10', 'B', 'B — They are thin and tightly compressed.', 'The final clause says the oldest layers are "thin and tightly compressed", which makes dating difficult.'),
  single('pb-q11', 'TRUE', 'True', 'Cores "several kilometres deep" are mentioned directly.'),
  single('pb-q12', 'B', 'B — Estimates drawn from the oldest layers are likely to be less precise.', 'The passage says dating the oldest layers is difficult. It never claims a perfect record (A), and nothing supports C or D. This is an inference: difficulty dating implies less precise estimates.'),
  single('pb-q13', 'B', 'B — Producing them takes far more labour than it used to.', 'One worker can treat only a few trees a day, and the price has nearly doubled: both point to much more labour per apple. Quality, ripening and bee behaviour are not discussed.'),
  text('pb-q14', ['brushes', 'brush'], 'brushes', 'The owners pollinate blossoms "by hand with small brushes".'),
];
