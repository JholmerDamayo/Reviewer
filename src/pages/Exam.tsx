import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import {
  getPracticeWorkspace,
  normalizePracticeTopics,
  type PracticeQuestionRecord,
  type PracticeQuizRecord,
  type PracticeTopicRecord,
  type PracticeWorkspace
} from '../lib/supabase';
import {
  QUIZ_COMPLETION_STORAGE_KEY,
  type QuizCompletionRecord
} from '../utils/examEligibility';
import { getCorrectChoiceLabel, isQuizReady, parsePromptChoices } from '../utils/quizSession';

const EXAM_MIN_QUESTIONS = 50;
const EXAM_PAGE_SIZE = 10;
const EXAM_PASSING_ACCURACY = 75;

type ExamQuestion = PracticeQuestionRecord & {
  examIndex: number;
  quizId: number;
  quizLabel: string;
  sessionKey: string;
};

type ExamResult = {
  accuracy: number;
  passed: boolean;
  questions: ExamQuestion[];
  quizLabel: string;
  responses: Record<string, string>;
  score: number;
  total: number;
};

function isCompletedQuiz(quiz: PracticeQuizRecord) {
  return isQuizReady(quiz) && quiz.attempts > 0;
}

function getUsableQuestionCount(quiz: PracticeQuizRecord) {
  return quiz.questions.filter(
    (question) => question.prompt.trim().length > 0 && question.answer.trim().length > 0
  ).length;
}

function isExamEligibleQuiz(quiz: PracticeQuizRecord) {
  return isCompletedQuiz(quiz) && getUsableQuestionCount(quiz) >= EXAM_MIN_QUESTIONS;
}

function buildExamQuestions(quiz: PracticeQuizRecord, topic: PracticeTopicRecord) {
  const usableQuestions = quiz.questions.filter(
    (question) => question.prompt.trim().length > 0 && question.answer.trim().length > 0
  );

  if (usableQuestions.length < EXAM_MIN_QUESTIONS) {
    return [] as ExamQuestion[];
  }

  const quizLabel = `${topic.title} ${quiz.id}`;

  return usableQuestions.map((question, index) => ({
    ...question,
    examIndex: index + 1,
    quizId: quiz.id,
    quizLabel,
    sessionKey: `${topic.id}-${quiz.id}-${question.id}-${index + 1}`
  }));
}

function Exam() {
  const { isAuthenticated, user } = useAuth();
  const [quizCompletionRecords] = useLocalStorage<QuizCompletionRecord[]>(
    QUIZ_COMPLETION_STORAGE_KEY,
    []
  );
  const [workspace, setWorkspace] = useState<PracticeWorkspace | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExamStarted, setIsExamStarted] = useState(false);
  const [currentQuestionPage, setCurrentQuestionPage] = useState(0);
  const [examResponses, setExamResponses] = useState<Record<string, string>>({});
  const [examResult, setExamResult] = useState<ExamResult | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !user.id) {
      return;
    }

    let cancelled = false;

    async function loadPracticeTopics() {
      setIsLoading(true);

      try {
        const nextWorkspace = await getPracticeWorkspace(user.id);

        if (cancelled) {
          return;
        }

        setWorkspace(nextWorkspace);
      } catch {
        return;
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadPracticeTopics();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user.id]);

  const practiceTopics = useMemo(() => normalizePracticeTopics(workspace), [workspace]);
  const completedQuizRecordMap = useMemo(
    () =>
      new Map(
        quizCompletionRecords
          .filter((record) => record.studentId === user.id)
          .map((record) => [`${record.topicId}-${record.quizId}`, record])
      ),
    [quizCompletionRecords, user.id]
  );
  const eligibleExamSource = useMemo(
    () =>
      practiceTopics
        .flatMap((topic) =>
          topic.quizzes.map((quiz) => ({
            topic,
            quiz
          }))
        )
        .filter(({ topic, quiz }) => completedQuizRecordMap.has(`${topic.id}-${quiz.id}`))
        .find(({ quiz }) => isExamEligibleQuiz(quiz)) ?? null,
    [completedQuizRecordMap, practiceTopics]
  );
  const examQuestions = useMemo(
    () =>
      eligibleExamSource
        ? buildExamQuestions(eligibleExamSource.quiz, eligibleExamSource.topic)
        : [],
    [eligibleExamSource]
  );
  const questionPageCount = Math.max(1, Math.ceil(examQuestions.length / EXAM_PAGE_SIZE));
  const visibleQuestions = examQuestions.slice(
    currentQuestionPage * EXAM_PAGE_SIZE,
    currentQuestionPage * EXAM_PAGE_SIZE + EXAM_PAGE_SIZE
  );

  function handleStartExam() {
    if (!eligibleExamSource || !examQuestions.length || isLoading) {
      return;
    }

    setIsExamStarted(true);
    setCurrentQuestionPage(0);
    setExamResponses({});
    setExamResult(null);
  }

  function handleChoiceResponse(sessionKey: string, value: string) {
    setExamResponses((current) => ({
      ...current,
      [sessionKey]: value
    }));
  }

  function handleNextQuestionPage() {
    setCurrentQuestionPage((current) => Math.min(current + 1, questionPageCount - 1));
  }

  function handlePreviousQuestionPage() {
    setCurrentQuestionPage((current) => Math.max(current - 1, 0));
  }

  function handleSubmitExam() {
    if (!eligibleExamSource || !examQuestions.length) {
      return;
    }

    const score = examQuestions.reduce((currentScore, question) => {
      const parsedQuestion = parsePromptChoices(question.prompt, question.answer);
      const submittedAnswer = examResponses[question.sessionKey] ?? '';

      if (parsedQuestion.choices.length > 1) {
        const correctChoiceLabel = getCorrectChoiceLabel(question.answer, parsedQuestion.choices);
        return submittedAnswer === correctChoiceLabel ? currentScore + 1 : currentScore;
      }

      return submittedAnswer.trim().toLowerCase() === question.answer.trim().toLowerCase()
        ? currentScore + 1
        : currentScore;
    }, 0);

    const total = examQuestions.length;
    const accuracy = total ? Math.round((score / total) * 100) : 0;

    setExamResult({
      accuracy,
      passed: accuracy >= EXAM_PASSING_ACCURACY,
      questions: examQuestions,
      quizLabel: `${eligibleExamSource.topic.title} ${eligibleExamSource.quiz.id}`,
      responses: Object.fromEntries(
        examQuestions.map((question) => [question.sessionKey, examResponses[question.sessionKey] ?? ''])
      ),
      score,
      total
    });
    setIsExamStarted(false);
    setCurrentQuestionPage(0);
  }

  return (
    <section className="quiz-builder-shell page-enter">
      {!isExamStarted ? (
        <>
          <div className="quiz-builder-intro">
            <span className="eyebrow">Exam</span>
            <h1>Exam</h1>
            <p>
              Start an exam from a quiz you already finished in the Quizzes page. The button below
              only turns on when one completed quiz has at least 50 finished questions.
            </p>
          </div>

          <div className="quiz-submit-row exam-submit-row">
            <button
              className="practice-submit exam-start-button"
              disabled={!eligibleExamSource || !examQuestions.length || isLoading}
              onClick={handleStartExam}
              type="button"
            >
              Start Exam
            </button>
          </div>

          {examResult && (
            <div className="quiz-results-board">
              <div className="practice-panel-head">
                <div>
                  <div className="practice-summary-label">Latest Exam Result</div>
                  <strong>{examResult.quizLabel}</strong>
                </div>
                <span className="quiz-counter-pill">
                  {examResult.passed ? 'Passed' : 'Needs Review'}
                </span>
              </div>

              <div className="exam-guide-grid">
                <article className="practice-preview-card">
                  <div className="practice-preview-label">Score</div>
                  <strong>
                    {examResult.score} / {examResult.total}
                  </strong>
                  <p>Your final number of correct answers from this exam session.</p>
                </article>

                <article className="practice-preview-card">
                  <div className="practice-preview-label">Accuracy</div>
                  <strong>{examResult.accuracy}%</strong>
                  <p>The current passing target is {EXAM_PASSING_ACCURACY}%.</p>
                </article>

                <article className="practice-preview-card">
                  <div className="practice-preview-label">Result</div>
                  <strong>{examResult.passed ? 'Pass' : 'Failed'}</strong>
                  <p>Choose the same completed quiz again anytime if you want to retake the exam.</p>
                </article>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="quiz-session-shell">
          <div className="quiz-builder-intro">
            <span className="eyebrow">Exam Session</span>
            <h1>Start Exam</h1>
            <p>Answer the questions on this page, click Next to continue, and Submit on the last page.</p>
            <div className="quiz-sync-note">
              Page {currentQuestionPage + 1} of {questionPageCount}
            </div>
          </div>

          <div className="quiz-session-head">
            <div className="quiz-selection-summary">
              <div className="practice-summary-label">Selected Quiz</div>
              <strong>
                {eligibleExamSource
                  ? `${eligibleExamSource.topic.title} ${eligibleExamSource.quiz.id}`
                  : 'No quiz selected'}
              </strong>
              <p>{examQuestions.length} total questions are ready for this exam.</p>
            </div>

            <div className="quiz-selection-summary">
              <div className="practice-summary-label">Question Range</div>
              <strong>
                {visibleQuestions[0]?.examIndex ?? 0}-{visibleQuestions[visibleQuestions.length - 1]?.examIndex ?? 0}
              </strong>
              <p>Questions are shown in groups of {EXAM_PAGE_SIZE} per page.</p>
            </div>
          </div>

          <div className="quiz-session-list">
            {visibleQuestions.map((question) => {
              const parsedQuestion = parsePromptChoices(question.prompt, question.answer);
              const responseValue = examResponses[question.sessionKey] ?? '';

              return (
                <article className="quiz-session-question" key={question.sessionKey}>
                  <div className="quiz-session-question-head">
                    <span className="practice-quiz-number">Q{question.examIndex}</span>
                    <span className="practice-quiz-pill">{question.quizLabel}</span>
                  </div>

                  <div className="quiz-session-question-copy">
                    <h3>{parsedQuestion.stem}</h3>

                    {parsedQuestion.choices.length > 1 ? (
                      <div className="practice-choice-list">
                        {parsedQuestion.choices.map((choice) => (
                          <button
                            key={`${question.sessionKey}-${choice.label}`}
                            className={`practice-choice-card ${
                              responseValue === choice.label ? 'selected' : ''
                            }`}
                            onClick={() => handleChoiceResponse(question.sessionKey, choice.label)}
                            type="button"
                          >
                            <span className="practice-choice-label">{choice.label}</span>
                            <span>{choice.text}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input
                        className="practice-answer-input"
                        onChange={(event) => handleChoiceResponse(question.sessionKey, event.target.value)}
                        placeholder="Type your answer"
                        type="text"
                        value={responseValue}
                      />
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="quiz-session-actions">
            {currentQuestionPage > 0 ? (
              <button className="practice-secondary-button" onClick={handlePreviousQuestionPage} type="button">
                Back
              </button>
            ) : (
              <span />
            )}

            {currentQuestionPage === questionPageCount - 1 ? (
              <button className="practice-submit" onClick={handleSubmitExam} type="button">
                Submit
              </button>
            ) : (
              <button className="practice-submit" onClick={handleNextQuestionPage} type="button">
                Next
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default Exam;
