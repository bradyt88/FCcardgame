// Local question bank for Family Circle.
// Each question has exactly 3 answers (1 correct, 2 incorrect), matching
// the rule sheet's "three possible answers" requirement.
//
// Replace/extend this freely — it's plain data. Group by `category` so
// the four presented questions per turn can be pulled from a mix of
// topics.

let uid = 0
const q = (category, question, correct, wrongs) => ({
  id: `q${uid++}`,
  category,
  question,
  answers: shuffleAnswers([
    { text: correct, correct: true },
    { text: wrongs[0], correct: false },
    { text: wrongs[1], correct: false },
  ]),
})

function shuffleAnswers(answers) {
  const a = answers.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const QUESTION_BANK = [
  // General knowledge
  q('General Knowledge', 'What is the capital of Japan?', 'Tokyo', ['Osaka', 'Kyoto']),
  q('General Knowledge', 'How many continents are there?', '7', ['5', '9']),
  q('General Knowledge', 'What colour is a ruby?', 'Red', ['Blue', 'Green']),
  q('General Knowledge', 'How many days are in a leap year?', '366', ['365', '367']),
  q('General Knowledge', 'What is the largest ocean on Earth?', 'Pacific', ['Atlantic', 'Indian']),
  q('General Knowledge', 'What do bees produce?', 'Honey', ['Silk', 'Wax only']),
  q('General Knowledge', 'How many players are on a football (soccer) team on the pitch?', '11', ['9', '10']),
  q('General Knowledge', 'What is the tallest mountain in the world?', 'Mount Everest', ['K2', 'Kilimanjaro']),
  q('General Knowledge', 'What is the freezing point of water in Celsius?', '0°C', ['10°C', '-10°C']),
  q('General Knowledge', 'Which planet is known as the Red Planet?', 'Mars', ['Venus', 'Jupiter']),

  // History
  q('History', 'In which century did the Titanic sink?', '20th century', ['19th century', '21st century']),
  q('History', 'Who was the first President of the United States?', 'George Washington', ['Thomas Jefferson', 'Abraham Lincoln']),
  q('History', 'The Great Wall is located in which country?', 'China', ['India', 'Mongolia']),
  q('History', 'Which ancient civilisation built the pyramids of Giza?', 'The Egyptians', ['The Romans', 'The Greeks']),
  q('History', 'In which year did World War II end?', '1945', ['1939', '1950']),
  q('History', 'Who painted the Mona Lisa?', 'Leonardo da Vinci', ['Michelangelo', 'Raphael']),
  q('History', 'The Vikings originally came from which region?', 'Scandinavia', ['Southern Europe', 'North Africa']),
  q('History', 'Which country gifted the Statue of Liberty to the USA?', 'France', ['Spain', 'Italy']),

  // Science & Nature
  q('Science & Nature', 'What gas do plants absorb from the air to make food?', 'Carbon dioxide', ['Oxygen', 'Nitrogen']),
  q('Science & Nature', 'How many bones are in the adult human body?', '206', ['186', '256']),
  q('Science & Nature', 'What is the chemical symbol for gold?', 'Au', ['Ag', 'Gd']),
  q('Science & Nature', 'What is the closest star to Earth?', 'The Sun', ['Proxima Centauri', 'Sirius']),
  q('Science & Nature', 'Which animal is the tallest in the world?', 'Giraffe', ['Elephant', 'Camel']),
  q('Science & Nature', 'What part of the plant conducts photosynthesis?', 'The leaves', ['The roots', 'The stem']),
  q('Science & Nature', 'How many hearts does an octopus have?', '3', ['1', '5']),
  q('Science & Nature', 'What is the hardest natural substance on Earth?', 'Diamond', ['Granite', 'Quartz']),

  // Entertainment
  q('Entertainment', 'Which instrument has 88 keys?', 'Piano', ['Guitar', 'Violin']),
  q('Entertainment', 'In "The Wizard of Oz", what does Dorothy\u2019s dog Toto do?', 'Nothing special \u2014 he\u2019s just her loyal dog', ['He talks', 'He flies']),
  q('Entertainment', 'How many strings does a standard guitar have?', '6', ['4', '8']),
  q('Entertainment', 'What is the best-selling toy of all time by units, a simple plastic building brick?', 'LEGO', ['Barbie', 'Rubik\u2019s Cube']),
  q('Entertainment', 'Which board game involves buying streets and paying rent?', 'Monopoly', ['Cluedo', 'Risk']),
  q('Entertainment', 'What do you call a group of musicians who play together?', 'A band', ['A troupe', 'A cast']),
  q('Entertainment', 'In darts, what is the highest score possible with three darts?', '180', ['170', '160']),

  // Sport
  q('Sport', 'How many players are on a basketball team on the court at once?', '5', ['6', '7']),
  q('Sport', 'In which sport would you perform a "slam dunk"?', 'Basketball', ['Volleyball', 'Tennis']),
  q('Sport', 'How often are the Summer Olympic Games held?', 'Every 4 years', ['Every 2 years', 'Every 5 years']),
  q('Sport', 'What is the maximum break in snooker?', '147', ['155', '130']),
  q('Sport', 'In tennis, what is a score of zero called?', 'Love', ['Nil', 'Duck']),
  q('Sport', 'How many rings are on the Olympic flag?', '5', ['4', '6']),
]

export function drawQuestions(askedIds, count = 4) {
  const remaining = QUESTION_BANK.filter((qq) => !askedIds.includes(qq.id))
  const pool = remaining.length >= count ? remaining : QUESTION_BANK
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}