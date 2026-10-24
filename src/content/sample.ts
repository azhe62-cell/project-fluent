/**
 * PUBLIC SAMPLE — deliberately tiny and separate from the real question bank.
 * These two items are shown to anyone (no account) and may be checked in the browser.
 * They are not part of any mock and do not reveal the bank's answers.
 */
export interface SampleItem { id: string; statement: string; answer: 'TRUE' | 'FALSE' | 'NOT_GIVEN'; why: string }

export const samplePassage = {
  title: 'The Night Market Clock',
  paragraphs: [
    'The old market clock in the harbour district was silent for forty years. Local traders blamed rust, but when engineers finally opened the case in 2019, they found that someone had packed the mechanism with sawdust to stop it chiming through the night.',
    'The clock now runs again, though it has been fitted with a dial that dims after ten o’clock. The restoration was funded partly by a neighbourhood raffle.',
  ],
};

export const sampleItems: SampleItem[] = [
  { id: 's1', statement: 'The clock stopped working because of rust.', answer: 'FALSE',
    why: 'The traders blamed rust, but the engineers found sawdust packed into the mechanism. The passage contradicts the rust explanation.' },
  { id: 's2', statement: 'Residents approved of the restored clock.', answer: 'NOT_GIVEN',
    why: 'We are told the clock was restored and how it was funded, but the passage never reports what residents thought of it.' },
];
