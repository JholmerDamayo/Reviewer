import type { PracticeQuizRecord } from '../lib/supabase';

export type ParsedChoice = {
  label: string;
  text: string;
};

export function isPlaceholderQuestion(prompt: string) {
  return /^Question\s+\d+$/i.test(prompt.trim());
}

export function isQuizReady(quiz: PracticeQuizRecord) {
  return (
    quiz.questions.length > 0 &&
    quiz.questions.every(
      (question) =>
        question.prompt.trim().length > 0 &&
        !isPlaceholderQuestion(question.prompt) &&
        question.answer.trim().length > 0
    )
  );
}

export function parsePromptChoices(prompt: string, answer: string) {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const choices: ParsedChoice[] = [];
  const stemLines: string[] = [];

  lines.forEach((line, index) => {
    const normalizedLine = index === 0 ? line.replace(/^\d+\.\s*/, '') : line;
    const choiceMatch = normalizedLine.match(/^([A-Z])\.\s*(.+)$/);

    if (choiceMatch) {
      choices.push({
        label: choiceMatch[1],
        text: choiceMatch[2]
      });
      return;
    }

    stemLines.push(normalizedLine);
  });

  if (!choices.length && answer.trim()) {
    choices.push({
      label: 'Answer',
      text: answer.trim()
    });
  }

  return {
    stem: stemLines.join('\n').trim() || prompt.trim(),
    choices
  };
}

export function getCorrectChoiceLabel(answer: string, choices: ParsedChoice[]) {
  const normalizedAnswer = answer.trim().toLowerCase();

  if (!normalizedAnswer) {
    return '';
  }

  const labelMatch = normalizedAnswer.match(/^([a-z])(?:\.|\)|\s|$)/);
  if (labelMatch) {
    return labelMatch[1].toUpperCase();
  }

  const exactChoice = choices.find(
    (choice) => choice.text.trim().toLowerCase() === normalizedAnswer
  );

  return exactChoice?.label ?? answer.trim();
}
