import type { PublicTest, PublicQuestion, SkillTag } from '@/engine/types';

/**
 * ORIGINAL CONTENT — written for this project. Not copied from any test-preparation
 * provider. Difficulty values are editorial estimates, not psychometric measurements.
 * Client-safe: contains NO answers. See reading-mini-mock-01.keys.ts for marking data.
 */

const q = (
  id: string, number: number, type: PublicQuestion['type'], passageId: string, prompt: string,
  extra: Partial<PublicQuestion> & { skillTags: SkillTag[]; topicTags: string[]; difficulty: 1 | 2 | 3 },
): PublicQuestion => ({ id, version: 1, number, type, passageId, prompt, marks: 1, ...extra });

const TF = [
  { id: 'TRUE', label: 'True' },
  { id: 'FALSE', label: 'False' },
  { id: 'NOT_GIVEN', label: 'Not Given' },
];
const PARA = ['A', 'B', 'C', 'D', 'E'].map((l) => ({ id: l, label: `Paragraph ${l}` }));

const WORDS1 = 'NO MORE THAN ONE WORD';

export const readingMiniMock01: PublicTest = {
  id: 'test-reading-mini-01',
  slug: 'reading-mini-mock-01',
  title: 'Reading Mini-Mock 1',
  description:
    'Two original passages on urban ecology and coastal defence. Nineteen questions across multiple choice, True/False/Not Given, sentence and summary completion, matching and short-answer formats.',
  assessmentType: 'reading',
  version: 1,
  durationSeconds: 20 * 60,
  scoringNote:
    'Raw practice marks only (20 available). This is a shortened mini-mock, not a full-length exam, so no band score is estimated.',
  passages: [
    {
      id: 'p-roofs',
      title: 'The Rooftop Meadow Experiment',
      kicker: 'Urban ecology',
      paragraphs: [
        { label: 'A', text: 'When the council of a mid-sized northern port first proposed planting meadows on municipal roofs in 2014, most residents assumed the plan was merely decorative. Officials, however, had a practical aim: to find out whether flat roofs, which make up almost a fifth of the built-up area, could support the pollinating insects that had been disappearing from the surrounding streets.' },
        { label: 'B', text: 'A team led by the ecologist Dr Marit Halloran surveyed forty roofs over six summers. Each roof was planted with one of three seed mixes: a drought-tolerant sedum blend, a mixed wildflower meadow, or a lawn-style grass with scattered clover. Volunteers counted visiting insects for twenty minutes every fortnight, always between ten in the morning and noon, when activity is most stable.' },
        { label: 'C', text: "The results surprised even the researchers. Wildflower roofs attracted on average three times as many species of bee and hoverfly as the sedum roofs, yet the sedum roofs were far cheaper to maintain, needing water only in the driest weeks. The clover-and-grass roofs performed worst of all, attracting mainly common species that were already abundant in the city's parks." },
        { label: 'D', text: 'Height proved less important than expected. It had been assumed that insects would rarely reach roofs above the tenth floor, but surveys recorded bumblebees on a roof 42 metres above the street. What mattered more was the presence of a "stepping stone": another planted roof or garden within roughly 300 metres. Isolated roofs, even those with ideal planting, were visited only occasionally.' },
        { label: 'E', text: 'The project also revealed limits. Soil on most roofs was only eight centimetres deep, too shallow for the taller plants that some specialised bees prefer, and several wildflower species died out after three winters. Halloran now argues that the council should fund "habitat corridors" — chains of connected roofs — rather than isolated showpieces, and that deeper planting beds should be built into new buildings from the outset. Critics reply that the extra weight would raise construction costs, and that the money would be better spent protecting existing parks.' },
      ],
    },
    {
      id: 'p-marsh',
      title: 'Letting the Tide Back In',
      kicker: 'Coastal engineering',
      paragraphs: [
        { label: 'A', text: 'For centuries, engineers along low-lying coasts did much the same thing: they built walls. Earth embankments held back the tide and turned tidal flats into farmland. By the 1950s, however, many of these walls were failing, and the cost of rebuilding them was beginning to exceed the value of the fields behind them.' },
        { label: 'B', text: 'In the 1990s a small number of coastal authorities tried a reversal known as managed realignment. Instead of repairing an old wall, they breached it deliberately, allowing seawater to flood the land behind. Within a few years, salt-tolerant plants such as glasswort and sea lavender had colonised the mud, and their dense stems began to slow the waves that crossed them.' },
        { label: 'C', text: 'The protective effect is measurable. Field studies suggest that a marsh a hundred metres wide can reduce wave height by more than half before the water reaches the remaining sea wall, which then needs less maintenance. Marshes also trap sediment, so in some places the land has been rising by several millimetres a year, partly keeping pace with the sea.' },
        { label: 'D', text: 'Yet the approach is not without problems. Farmers whose land is flooded must be compensated, and negotiations can last for years. Some new marshes have also developed more slowly than predicted: where land had sunk after centuries of drainage, it sat too low, and tidal water covered it for too long for plants to establish. Engineers have responded by delivering dredged mud to raise the ground before the wall is opened.' },
        { label: 'E', text: 'Not everyone is convinced that marshes can replace walls entirely. The ecologist Tomas Reyes points out that a marsh protects best against ordinary storms, whereas the most extreme surges can overtop it. He recommends treating marshes as the first of two lines of defence, with a smaller wall retained behind them.' },
      ],
    },
  ],
  sections: [
    {
      id: 's-roofs', title: 'Passage 1 — The Rooftop Meadow Experiment', passageId: 'p-roofs',
      groups: [
        { id: 'g1', heading: 'Questions 1–2', instructions: 'Choose the correct letter, A, B, C or D.', questionIds: ['rd01-q01', 'rd01-q02'] },
        { id: 'g2', heading: 'Questions 3–5', instructions: 'Do the following statements agree with the information in the passage? Choose TRUE if the statement agrees, FALSE if it contradicts the passage, or NOT GIVEN if there is no information on this.', questionIds: ['rd01-q03', 'rd01-q04', 'rd01-q05'] },
        { id: 'g3', heading: 'Questions 6–8', instructions: 'Complete each sentence with words from the passage. Use the word limit shown for each question.', questionIds: ['rd01-q06', 'rd01-q07', 'rd01-q08'] },
        { id: 'g4', heading: 'Question 9', instructions: 'Choose TWO letters. This question is worth 2 marks: 1 for each correct choice.', questionIds: ['rd01-q09'] },
      ],
    },
    {
      id: 's-marsh', title: 'Passage 2 — Letting the Tide Back In', passageId: 'p-marsh',
      groups: [
        { id: 'g5', heading: 'Question 10', instructions: 'Choose the correct letter, A, B, C or D.', questionIds: ['rd01-q10'] },
        { id: 'g6', heading: 'Questions 11–13', instructions: 'Do the following statements agree with the information in the passage? Choose TRUE, FALSE or NOT GIVEN.', questionIds: ['rd01-q11', 'rd01-q12', 'rd01-q13'] },
        { id: 'g7', heading: 'Questions 14–15', instructions: 'Which paragraph contains the following information? Choose the correct letter, A–E.', questionIds: ['rd01-q14', 'rd01-q15'], sharedOptions: PARA },
        { id: 'g8', heading: 'Questions 16–18', instructions: 'Complete the summary below. Write ONE WORD ONLY from the passage for each answer.', questionIds: ['rd01-q16', 'rd01-q17', 'rd01-q18'], variant: 'summary' },
        { id: 'g9', heading: 'Question 19', instructions: 'Answer the question below using NO MORE THAN THREE WORDS from the passage.', questionIds: ['rd01-q19'] },
      ],
    },
  ],
  questions: [
    q('rd01-q01', 1, 'multiple_choice', 'p-roofs', "What was the council's main purpose in planting the roofs?", {
      options: [
        { id: 'A', label: 'to make public buildings look more attractive' },
        { id: 'B', label: 'to find out whether roofs could support pollinating insects' },
        { id: 'C', label: 'to reduce heating costs in municipal buildings' },
        { id: 'D', label: 'to grow food for local residents' },
      ],
      skillTags: ['inference', 'paraphrase_recognition'], topicTags: ['urban-ecology'], difficulty: 1,
    }),
    q('rd01-q02', 2, 'multiple_choice', 'p-roofs', 'Why were the insect counts always made between ten in the morning and noon?', {
      options: [
        { id: 'A', label: 'Fewer volunteers were available later in the day.' },
        { id: 'B', label: 'Insects were easier to identify in strong sunlight.' },
        { id: 'C', label: 'Insect activity is most consistent at that time.' },
        { id: 'D', label: 'Rain was less likely in the morning.' },
      ],
      skillTags: ['locating_detail', 'paraphrase_recognition'], topicTags: ['urban-ecology', 'research-method'], difficulty: 2,
    }),
    q('rd01-q03', 3, 'true_false_not_given', 'p-roofs', 'Wildflower roofs attracted more species of bee and hoverfly than sedum roofs.', {
      options: TF, skillTags: ['identifying_writer_claims', 'locating_detail'], topicTags: ['urban-ecology'], difficulty: 1,
    }),
    q('rd01-q04', 4, 'true_false_not_given', 'p-roofs', 'The sedum roofs needed regular watering throughout every summer.', {
      options: TF, skillTags: ['identifying_writer_claims', 'paraphrase_recognition'], topicTags: ['urban-ecology'], difficulty: 2,
    }),
    q('rd01-q05', 5, 'true_false_not_given', 'p-roofs', 'The volunteers who counted insects were paid for their time.', {
      options: TF, skillTags: ['identifying_writer_claims'], topicTags: ['urban-ecology', 'research-method'], difficulty: 2,
    }),
    q('rd01-q06', 6, 'sentence_completion', 'p-roofs', 'The clover-and-grass roofs mainly attracted ______ species.', {
      wordLimit: 1, instructions: WORDS1, skillTags: ['vocabulary_precision', 'locating_detail'], topicTags: ['urban-ecology'], difficulty: 1,
    }),
    q('rd01-q07', 7, 'sentence_completion', 'p-roofs', 'Roofs with no other planted site within roughly 300 metres were visited only ______, even when well planted.', {
      wordLimit: 1, instructions: WORDS1, skillTags: ['vocabulary_precision', 'locating_detail'], topicTags: ['urban-ecology'], difficulty: 2,
    }),
    q('rd01-q08', 8, 'sentence_completion', 'p-roofs', 'Halloran believes new buildings should be built with deeper planting ______ from the outset.', {
      wordLimit: 1, instructions: WORDS1, skillTags: ['vocabulary_precision', 'locating_detail'], topicTags: ['urban-ecology', 'policy'], difficulty: 2,
    }),
    q('rd01-q09', 9, 'multi_select', 'p-roofs', 'Which TWO limitations of the project are mentioned in the passage?', {
      selectCount: 2, marks: 2,
      options: [
        { id: 'A', label: 'The soil was too shallow for some taller plants.' },
        { id: 'B', label: 'Volunteers lost interest in counting insects.' },
        { id: 'C', label: 'Some wildflower species did not survive beyond three winters.' },
        { id: 'D', label: 'Strong wind made the roofs unsafe to visit.' },
        { id: 'E', label: 'The council cut funding after the first six summers.' },
      ],
      skillTags: ['locating_detail', 'paraphrase_recognition'], topicTags: ['urban-ecology'], difficulty: 3,
    }),
    q('rd01-q10', 10, 'multiple_choice', 'p-marsh', 'Which problem with sea walls is described in paragraph A?', {
      options: [
        { id: 'A', label: 'They were too low to stop ordinary tides.' },
        { id: 'B', label: 'Rebuilding them could cost more than the land they protected was worth.' },
        { id: 'C', label: 'They damaged the farmland behind them.' },
        { id: 'D', label: 'Few engineers knew how to maintain them.' },
      ],
      skillTags: ['paraphrase_recognition', 'locating_detail'], topicTags: ['coastal-engineering'], difficulty: 1,
    }),
    q('rd01-q11', 11, 'true_false_not_given', 'p-marsh', 'Managed realignment was first tried in the 1950s.', {
      options: TF, skillTags: ['identifying_writer_claims', 'locating_detail'], topicTags: ['coastal-engineering'], difficulty: 1,
    }),
    q('rd01-q12', 12, 'true_false_not_given', 'p-marsh', 'Plants that colonise a breached area can slow incoming waves.', {
      options: TF, skillTags: ['identifying_writer_claims', 'paraphrase_recognition'], topicTags: ['coastal-engineering'], difficulty: 1,
    }),
    q('rd01-q13', 13, 'true_false_not_given', 'p-marsh', 'Creating a salt marsh costs less than building a new sea wall.', {
      options: TF, skillTags: ['identifying_writer_claims'], topicTags: ['coastal-engineering', 'policy'], difficulty: 3,
    }),
    q('rd01-q14', 14, 'matching_information', 'p-marsh', 'a method used to correct slow marsh development', {
      options: PARA, skillTags: ['scanning_paragraphs', 'paraphrase_recognition'], topicTags: ['coastal-engineering'], difficulty: 2,
    }),
    q('rd01-q15', 15, 'matching_information', 'p-marsh', 'a warning that marshes may not cope with the most extreme storms', {
      options: PARA, skillTags: ['scanning_paragraphs', 'paraphrase_recognition'], topicTags: ['coastal-engineering'], difficulty: 2,
    }),
    q('rd01-q16', 16, 'summary_completion', 'p-marsh', 'A marsh one hundred metres wide may reduce wave height by more than ______ before the water reaches the sea wall.', {
      wordLimit: 1, instructions: WORDS1, skillTags: ['vocabulary_precision', 'locating_detail'], topicTags: ['coastal-engineering'], difficulty: 1,
    }),
    q('rd01-q17', 17, 'summary_completion', 'p-marsh', 'Because marshes trap ______, the land in some of them gradually gains height.', {
      wordLimit: 1, instructions: WORDS1, skillTags: ['vocabulary_precision', 'locating_detail'], topicTags: ['coastal-engineering'], difficulty: 1,
    }),
    q('rd01-q18', 18, 'summary_completion', 'p-marsh', 'Where land has sunk too low, engineers deliver dredged ______ to raise it before the wall is breached.', {
      wordLimit: 1, instructions: WORDS1, skillTags: ['vocabulary_precision', 'locating_detail'], topicTags: ['coastal-engineering'], difficulty: 2,
    }),
    q('rd01-q19', 19, 'short_answer', 'p-marsh', 'What does Tomas Reyes suggest keeping behind a marsh?', {
      wordLimit: 3, instructions: 'NO MORE THAN THREE WORDS', skillTags: ['locating_detail', 'vocabulary_precision'], topicTags: ['coastal-engineering', 'policy'], difficulty: 2,
    }),
  ],
};
