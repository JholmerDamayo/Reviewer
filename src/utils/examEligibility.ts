export const QUIZ_COMPLETION_STORAGE_KEY = 'reviewer-os-quiz-completions';

export type QuizCompletionRecord = {
  completedAt: string;
  questionCount: number;
  quizId: number;
  studentId: string;
  topicId: number;
  topicTitle: string;
};

export function upsertQuizCompletionRecords(
  current: QuizCompletionRecord[],
  next: QuizCompletionRecord[]
) {
  const recordMap = new Map<string, QuizCompletionRecord>();

  [...current, ...next].forEach((record) => {
    recordMap.set(`${record.studentId}-${record.topicId}-${record.quizId}`, record);
  });

  return Array.from(recordMap.values()).sort((left, right) =>
    left.completedAt < right.completedAt ? 1 : -1
  );
}
