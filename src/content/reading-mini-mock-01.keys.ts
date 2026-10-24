import type { AnswerKey } from '@/engine/types';

/**
 * SERVER-ONLY marking data. Never import this from components or pages.
 * (Imported by: the local demo adapter via dynamic import, the seed generator, tests,
 *  and mirrored into Postgres `answer_keys` for the Supabase path.)
 */

const single = (questionId: string, correct: string, display: string, explanation: string): AnswerKey => ({
  questionId, version: 1, marks: 1, rule: { kind: 'single', correct }, display, explanation,
});
const text = (
  questionId: string, accepted: string[], maxWords: number, display: string, explanation: string,
): AnswerKey => ({
  questionId, version: 1, marks: 1, rule: { kind: 'text', accepted, maxWords, ignorePunctuation: true }, display, explanation,
});

export const readingMiniMock01Keys: AnswerKey[] = [
  single('rd01-q01', 'B', 'B — to find out whether roofs could support pollinating insects',
    'Paragraph A says the residents thought the plan was "decorative", but the officials had a practical aim: testing whether flat roofs could support insects that were vanishing from nearby streets. Option A is the residents\' assumption, not the officials\' purpose.'),
  single('rd01-q02', 'C', 'C — Insect activity is most consistent at that time.',
    'Paragraph B gives the reason in a clause: activity is "most stable" between ten and noon. "Most stable" is paraphrased as "most consistent". Nothing in the paragraph mentions volunteers, sunlight or rain.'),
  single('rd01-q03', 'TRUE', 'True',
    'Paragraph C states that wildflower roofs attracted about three times as many bee and hoverfly species as sedum roofs, so they attracted more.'),
  single('rd01-q04', 'FALSE', 'False',
    'Paragraph C says the sedum roofs needed water "only in the driest weeks". That contradicts watering regularly throughout every summer.'),
  single('rd01-q05', 'NOT_GIVEN', 'Not Given',
    'Paragraph B says volunteers did the counting, but the passage never says whether they were paid or unpaid. When a detail is simply absent, the answer is Not Given — not False.'),
  text('rd01-q06', ['common'], 1, 'common',
    'Paragraph C: the clover-and-grass roofs attracted "mainly common species" already abundant in the city\'s parks.'),
  text('rd01-q07', ['occasionally'], 1, 'occasionally',
    'Paragraph D: isolated roofs, even those with ideal planting, were "visited only occasionally". The sentence stem paraphrases "isolated" as "no other planted site within roughly 300 metres".'),
  text('rd01-q08', ['beds', 'bed'], 1, 'beds',
    'Paragraph E: Halloran says "deeper planting beds should be built into new buildings from the outset". The stem already supplies the word "planting", so only "beds" fits the gap.'),
  {
    questionId: 'rd01-q09', version: 1, marks: 2,
    rule: { kind: 'multi', correct: ['A', 'C'], partial: true },
    display: 'A and C',
    explanation:
      'Both limitations are in paragraph E: the eight-centimetre soil was too shallow for taller plants (A), and several wildflower species died out after three winters (C). Volunteers losing interest, wind and funding cuts are never mentioned. Marking: 1 mark per correct choice, no deduction for a wrong choice; selecting more than two choices scores zero.',
  },
  single('rd01-q10', 'B', 'B — Rebuilding them could cost more than the land they protected was worth.',
    'Paragraph A: the cost of rebuilding the walls "was beginning to exceed the value of the fields behind them". Option C reverses the text — the walls turned tidal flats into farmland.'),
  single('rd01-q11', 'FALSE', 'False',
    'Paragraph A mentions the 1950s as the period when walls were failing. Paragraph B says managed realignment was tried in the 1990s.'),
  single('rd01-q12', 'TRUE', 'True',
    'Paragraph B: once salt-tolerant plants colonised the breached land, their dense stems "began to slow the waves that crossed them".'),
  single('rd01-q13', 'NOT_GIVEN', 'Not Given',
    'The passage compares marshes and walls on protection and maintenance, and says rebuilding old walls was costly, but it never compares the cost of creating a marsh with the cost of a new wall.'),
  single('rd01-q14', 'D', 'Paragraph D',
    'Paragraph D describes slow-developing marshes on land that had sunk, and the fix: engineers deliver dredged mud to raise the ground before the wall is opened.'),
  single('rd01-q15', 'E', 'Paragraph E',
    'In paragraph E, Reyes warns that "the most extreme surges can overtop" a marsh, which is why he suggests a second line of defence.'),
  text('rd01-q16', ['half'], 1, 'half',
    'Paragraph C: a hundred-metre marsh can reduce wave height by "more than half".'),
  text('rd01-q17', ['sediment'], 1, 'sediment',
    'Paragraph C: "Marshes also trap sediment, so in some places the land has been rising."'),
  text('rd01-q18', ['mud'], 1, 'mud',
    'Paragraph D: engineers respond by "delivering dredged mud to raise the ground before the wall is opened".'),
  text('rd01-q19', ['a smaller wall', 'smaller wall'], 3, 'a smaller wall',
    'Paragraph E: Reyes recommends "a smaller wall retained behind" the marshes. The limit is three words, so "smaller wall" and "a smaller wall" both fit; "a smaller sea wall" would be four words and not accepted.'),
];
