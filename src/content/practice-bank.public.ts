import type { Passage, PublicQuestion, SkillTag } from '@/engine/types';

/**
 * ORIGINAL practice bank for targeted practice (Mistake Vault follow-ups).
 * Short passages, one or two skills each. Client-safe: no answers.
 * `number` is 0 because these items are not part of a numbered mock.
 */

const TF = [
  { id: 'TRUE', label: 'True' },
  { id: 'FALSE', label: 'False' },
  { id: 'NOT_GIVEN', label: 'Not Given' },
];

const q = (
  id: string, type: PublicQuestion['type'], passageId: string, prompt: string,
  extra: Partial<PublicQuestion> & { skillTags: SkillTag[]; topicTags: string[]; difficulty: 1 | 2 | 3 },
): PublicQuestion => ({ id, version: 1, number: 0, type, passageId, prompt, marks: 1, ...extra });

export const practiceBank = {
  id: 'bank-reading-v1',
  passages: [
    {
      id: 'pb-lighthouse', title: "The Lamp-Keepers' Logbooks", kicker: 'History',
      paragraphs: [{ text: 'Logbooks kept by lighthouse keepers on the north coast between 1880 and 1930 record far more than the weather. Keepers noted passing ships, repairs to the lamp and, surprisingly often, the birds that struck the glass on foggy nights. A recent project has digitised the entries so that ornithologists can compare them with modern migration records.' }],
    },
    {
      id: 'pb-bakery', title: 'The Overnight Bakery', kicker: 'Everyday systems',
      paragraphs: [{ text: 'In many towns, bread is baked while most people sleep. Bakers begin at about midnight, when dough prepared the previous afternoon has finished a slow rise in cool rooms. Working before dawn means loaves reach shops still warm, and ovens, which take hours to heat, can be run at their most efficient when electricity demand is low.' }],
    },
    {
      id: 'pb-library', title: 'The Library of Things', kicker: 'Community',
      paragraphs: [
        { label: 'A', text: 'In several neighbourhoods, a library now lends objects as well as books: drills, sewing machines, tents and even telescopes. Members pay a small yearly fee and may borrow an item for up to a week.' },
        { label: 'B', text: 'Organisers say the idea reduces waste, because most households use a drill for only a few minutes in its whole life. Some residents worry that items will come back damaged, so each tool is inspected and repaired by volunteers after every loan.' },
      ],
    },
    {
      id: 'pb-ice', title: 'Reading the Ice', kicker: 'Climate science',
      paragraphs: [{ text: 'Layers in glacier ice trap tiny bubbles of ancient air. Scientists drilling cores several kilometres deep can measure the gases in those bubbles to estimate past atmospheric conditions, although the oldest layers are thin and tightly compressed, which makes dating them difficult.' }],
    },
    {
      id: 'pb-orchard', title: 'The Silent Orchard', kicker: 'Agriculture',
      paragraphs: [{ text: "After the local bee population collapsed, the orchard's owners began pollinating blossoms by hand with small brushes. The method works, but a single worker can treat only a few trees each day, and the apples now sell at nearly double the price." }],
    },
  ] as Passage[],
  questions: [
    q('pb-q01', 'true_false_not_given', 'pb-lighthouse', 'The logbooks recorded only weather conditions.', { options: TF, skillTags: ['identifying_writer_claims'], topicTags: ['history'], difficulty: 1 }),
    q('pb-q02', 'true_false_not_given', 'pb-lighthouse', 'The keepers had been trained as ornithologists.', { options: TF, skillTags: ['identifying_writer_claims'], topicTags: ['history'], difficulty: 2 }),
    q('pb-q03', 'sentence_completion', 'pb-lighthouse', 'Birds were most often recorded striking the glass on ______ nights.', { wordLimit: 1, instructions: 'NO MORE THAN ONE WORD', skillTags: ['vocabulary_precision', 'locating_detail'], topicTags: ['history'], difficulty: 1 }),
    q('pb-q04', 'multiple_choice', 'pb-bakery', 'According to the passage, why does bread often reach shops still warm?', {
      options: [
        { id: 'A', label: 'Shops keep their own ovens running all day.' },
        { id: 'B', label: 'The baking is finished just before dawn.' },
        { id: 'C', label: 'Dough is delivered to shops to be baked there.' },
        { id: 'D', label: 'Bakers use warmer flour at night.' },
      ],
      skillTags: ['paraphrase_recognition', 'inference'], topicTags: ['everyday-systems'], difficulty: 2,
    }),
    q('pb-q05', 'sentence_completion', 'pb-bakery', 'Dough prepared the previous afternoon finishes a slow rise in ______ rooms.', { wordLimit: 1, instructions: 'NO MORE THAN ONE WORD', skillTags: ['vocabulary_precision', 'locating_detail'], topicTags: ['everyday-systems'], difficulty: 1 }),
    q('pb-q06', 'true_false_not_given', 'pb-bakery', 'Night baking takes advantage of lower electricity demand.', { options: TF, skillTags: ['identifying_writer_claims', 'paraphrase_recognition'], topicTags: ['everyday-systems'], difficulty: 2 }),
    q('pb-q07', 'matching_information', 'pb-library', 'a concern about the condition of returned items', {
      options: [{ id: 'A', label: 'Paragraph A' }, { id: 'B', label: 'Paragraph B' }],
      skillTags: ['scanning_paragraphs'], topicTags: ['community'], difficulty: 1,
    }),
    q('pb-q08', 'matching_information', 'pb-library', 'the length of time an item may be borrowed', {
      options: [{ id: 'A', label: 'Paragraph A' }, { id: 'B', label: 'Paragraph B' }],
      skillTags: ['scanning_paragraphs'], topicTags: ['community'], difficulty: 1,
    }),
    q('pb-q09', 'sentence_completion', 'pb-library', 'After every loan, each tool is inspected and repaired by ______.', { wordLimit: 1, instructions: 'NO MORE THAN ONE WORD', skillTags: ['vocabulary_precision', 'locating_detail'], topicTags: ['community'], difficulty: 1 }),
    q('pb-q10', 'multiple_choice', 'pb-ice', 'What makes the oldest layers of ice difficult to date?', {
      options: [
        { id: 'A', label: 'They contain no air bubbles.' },
        { id: 'B', label: 'They are thin and tightly compressed.' },
        { id: 'C', label: 'They lie beneath solid rock.' },
        { id: 'D', label: 'Drilling destroys them.' },
      ],
      skillTags: ['paraphrase_recognition', 'locating_detail'], topicTags: ['climate-science'], difficulty: 1,
    }),
    q('pb-q11', 'true_false_not_given', 'pb-ice', 'Ice cores can be drilled to depths of several kilometres.', { options: TF, skillTags: ['identifying_writer_claims', 'locating_detail'], topicTags: ['climate-science'], difficulty: 1 }),
    q('pb-q12', 'multiple_choice', 'pb-ice', 'Which statement is best supported by the passage?', {
      options: [
        { id: 'A', label: 'Ice cores give a perfect record of every single year.' },
        { id: 'B', label: 'Estimates drawn from the oldest layers are likely to be less precise.' },
        { id: 'C', label: 'Glaciers contain no modern air.' },
        { id: 'D', label: 'The trapped gases must be measured at the drilling site.' },
      ],
      skillTags: ['inference'], topicTags: ['climate-science'], difficulty: 3,
    }),
    q('pb-q13', 'multiple_choice', 'pb-orchard', 'What can be inferred about the hand-pollinated apples?', {
      options: [
        { id: 'A', label: 'They are of lower quality than before.' },
        { id: 'B', label: 'Producing them takes far more labour than it used to.' },
        { id: 'C', label: 'They ripen earlier in the season.' },
        { id: 'D', label: 'Bees refuse to visit their blossoms.' },
      ],
      skillTags: ['inference'], topicTags: ['agriculture'], difficulty: 2,
    }),
    q('pb-q14', 'sentence_completion', 'pb-orchard', 'The owners pollinate blossoms by hand using small ______.', { wordLimit: 1, instructions: 'NO MORE THAN ONE WORD', skillTags: ['vocabulary_precision', 'locating_detail'], topicTags: ['agriculture'], difficulty: 1 }),
  ] as PublicQuestion[],
};
